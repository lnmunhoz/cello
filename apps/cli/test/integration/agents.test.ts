// CEL-55 against a real server: subagents share their parent's session, so the Claude Code hooks and
// CELLO_AGENT say which one is working. A launch names its task; the subagent's tool calls check it in;
// SubagentStart hands it its CELLO_AGENT; a cello command carrying it is credited to it; SubagentStop
// ends it. Claims stay on the session.
import * as fs from "node:fs"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo } from "./cli.ts"

const X = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const BUILDER = "a13bfb89c0de1234f"
const REVIEWER = "b77d0e11aa22bb33c"
const claude = { CLAUDE_CODE_SESSION_ID: X, CLAUDE_PID: String(process.pid) }

/** Project CEL with two tasks; session X claimed both, as an orchestrator does. */
const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port)
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })
  const x = cello({ port, env: claude, cwd: repo })
  yield* x("task", "create", "Agents on cards")
  yield* x("task", "create", "Sidebar list")
  yield* x("task", "claim", "CEL-1")
  yield* x("task", "claim", "CEL-2")
  return {
    human,
    repo,
    x,
    as: (agent: string) => cello({ port, env: { ...claude, CELLO_AGENT: agent }, cwd: repo }),
    /** The hook as Claude Code runs it: no session in the environment, the JSON on stdin. */
    hook: (event: string, input: Record<string, unknown>) => cello({ port, env: {}, cwd: repo, stdin: JSON.stringify(input) })("hook", "claude", event),
    agents: Effect.map(human["snapshot.get"]({}), (s) => s.agents.map((a) => ({ id: a.agentId, type: a.agentType, task: s.tasks.find((t) => t.id === a.taskId)?.key ?? null, ended: a.endedAt !== null }))),
  }
})

/** The parent's PostToolUse after the Agent tool launched a background subagent. */
const launch = (agentId: string, subagent_type: string, description: string, prompt: string) => ({
  session_id: X,
  hook_event_name: "PostToolUse",
  tool_name: "Agent",
  tool_input: { description, prompt, subagent_type, run_in_background: true },
  tool_response: { isAsync: true, status: "async_launched", agentId, description, prompt, outputFile: "/tmp/out" },
  tool_use_id: "toolu_1",
})

describe("subagents through the hooks", () => {
  it.live("a launch names the agent's task; its tool calls check it in under the session; two agents of one session both show", () =>
    Effect.gen(function* () {
      const { hook, agents } = yield* setup
      expect(yield* hook("post-tool-use", launch(BUILDER, "cello-builder", "CEL-1 agents on cards", "Build CEL-1, after CEL-2"))).toEqual({ out: "", failure: null })
      expect(yield* hook("post-tool-use", launch(REVIEWER, "cello-code-reviewer", "Review the branch", "Review CEL-2's diff"))).toEqual({ out: "", failure: null })

      // A tool call inside the builder: the hook checks it in, silently.
      const post = { session_id: X, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "bun run test" }, tool_response: {}, tool_use_id: "t2" }
      expect(yield* hook("post-tool-use", { ...post, agent_id: BUILDER, agent_type: "cello-builder" })).toEqual({ out: "", failure: null })

      expect(yield* agents).toEqual([
        { id: BUILDER, type: "cello-builder", task: "CEL-1", ended: false },
        { id: REVIEWER, type: "cello-code-reviewer", task: "CEL-2", ended: false },
      ])
    }).pipe(Effect.scoped))

  it.live("a subagent that only shows up in its tool calls (no launch seen) is recorded with its type, under the session", () =>
    Effect.gen(function* () {
      const { hook, agents } = yield* setup
      yield* hook("post-tool-use", { session_id: X, hook_event_name: "PostToolUse", tool_name: "Read", agent_id: "c0ffee00", agent_type: "Explore" })
      expect(yield* agents).toEqual([{ id: "c0ffee00", type: "Explore", task: null, ended: false }])
    }).pipe(Effect.scoped))

  it.live("SubagentStart hands the subagent its --agent as context; SubagentStop marks it finished", () =>
    Effect.gen(function* () {
      const { hook, agents, x } = yield* setup
      const start = yield* hook("subagent-start", { session_id: X, hook_event_name: "SubagentStart", agent_id: BUILDER, agent_type: "cello-builder" })
      yield* hook("post-tool-use", launch(BUILDER, "cello-builder", "CEL-1 agents on cards", "Build CEL-1"))
      expect(start.failure).toBeNull()
      const context = JSON.parse(start.out).hookSpecificOutput
      expect(context.hookEventName).toBe("SubagentStart")
      expect(context.additionalContext).toContain(`cello --agent cello-builder/${BUILDER} task comment`)
      expect((yield* agents)[0]).toMatchObject({ id: BUILDER, ended: false })

      expect(yield* hook("subagent-stop", { session_id: X, hook_event_name: "SubagentStop", agent_id: BUILDER, agent_type: "cello-builder" })).toEqual({ out: "", failure: null })
      // A finished agent stays on the board, ended, for a day (Finished today, CEL-107); the task still lists it.
      expect(yield* agents).toEqual([{ id: BUILDER, type: "cello-builder", task: "CEL-1", ended: true }])
      expect((yield* x("task", "get", "CEL-1")).out).toContain(`Subagents on it (1)
  cello-builder · ${BUILDER.slice(0, 8)} (under Claude Code session 2fd0505c): finished just now`)
      // Claude Code's own helpers stop without starting: nothing is recorded.
      yield* hook("subagent-stop", { session_id: X, hook_event_name: "SubagentStop", agent_id: "prompt-suggestion", agent_type: "" })
      expect((yield* x("task", "get", "CEL-1")).out).toContain("Subagents on it (1)")
    }).pipe(Effect.scoped))

  it.live("a hook event this cello doesn't know (a newer settings file, an older binary) exits 0 and prints nothing, so Claude Code shows no hook error", () =>
    Effect.gen(function* () {
      const { hook } = yield* setup
      expect(yield* hook("some-future-event", { session_id: X, hook_event_name: "SomeFutureEvent" })).toEqual({ out: "", failure: null })
    }).pipe(Effect.scoped))
})

// CEL-133: Lucas saw `cello-builder · a825620e` under Finished today while its log said "The review-mode
// run is still going; I'll wait for the monitor's notice." The hooks, in the order Claude Code fires them.
describe("a subagent that ends its turn with its own background work running", () => {
  it.live("waits on it instead of finishing; its next tool call has it working; the stop after its work ended finishes it", () =>
    Effect.gen(function* () {
      const { hook, human } = yield* setup
      const as = { session_id: X, agent_id: BUILDER, agent_type: "cello-builder" }
      const builder = Effect.map(human["snapshot.get"]({}), (s) => s.agents.find((a) => a.agentId === BUILDER)!)
      yield* hook("subagent-start", { ...as, hook_event_name: "SubagentStart" })
      yield* hook("post-tool-use", launch(BUILDER, "cello-builder", "CEL-1 agents on cards", "Build CEL-1"))
      // It starts the review-mode e2e run in the background, then ends its turn while it runs.
      yield* hook("post-tool-use", {
        ...as, hook_event_name: "PostToolUse", tool_name: "Bash", tool_use_id: "toolu_e2e",
        tool_input: { command: "CELLO_E2E_REVIEW=1 bun run test:docker:e2e -- e2e/agents-page.spec.ts", run_in_background: true },
        tool_response: { stdout: "", stderr: "", interrupted: false, isImage: false, noOutputExpected: false, backgroundTaskId: "blo3xolgq" },
      })
      // background_tasks lists the whole session's work: the parent's waiter is there too.
      const running = [
        { id: "blo3xolgq", type: "shell", status: "running", description: "Run related e2e specs in review mode", command: "CELLO_E2E_REVIEW=1 bun run test:docker:e2e" },
        { id: "bwait0001", type: "shell", status: "running", description: "wait", command: "cello inbox --wait" },
      ]
      expect(yield* hook("subagent-stop", { ...as, hook_event_name: "SubagentStop", background_tasks: running })).toEqual({ out: "", failure: null })
      expect(yield* builder).toMatchObject({
        endedAt: null,
        waitingOn: ["Bash · CELLO_E2E_REVIEW=1 bun run test:docker:e2e -- e2e/agents-page.spec.ts"],
      })

      // The run ends; Claude Code resumes it and it reads the results.
      yield* hook("post-tool-use", { ...as, hook_event_name: "PostToolUse", tool_name: "Read", tool_input: { file_path: "/repo/summary.txt" }, tool_response: {} })
      expect(yield* builder).toMatchObject({ endedAt: null, waitingOn: null, currentStep: "Read · summary.txt" })

      yield* hook("subagent-stop", { ...as, hook_event_name: "SubagentStop", background_tasks: [running[1]] })
      const done = yield* builder
      expect(done.endedAt).not.toBeNull()
      expect(done.waitingOn).toBeNull()
    }).pipe(Effect.scoped))
})

// CEL-134: the hooks say when a subagent's Bash call runs tests; the runner's `cello test progress`,
// which carries only the session, says where the run is.
describe("a subagent running tests", () => {
  it.live("a background e2e run: Running tests from PreToolUse, its progress from the runner's file, ended by its last report", () =>
    Effect.gen(function* () {
      const { hook, human, x, repo } = yield* setup
      const as = { session_id: X, agent_id: BUILDER, agent_type: "cello-builder", cwd: repo }
      const tests = Effect.map(human["snapshot.get"]({}), (s) => s.agents.find((a) => a.agentId === BUILDER)?.tests ?? null)
      yield* hook("post-tool-use", launch(BUILDER, "cello-builder", "CEL-1 agents on cards", "Build CEL-1"))
      const call = { ...as, tool_name: "Bash", tool_use_id: "toolu_e2e", tool_input: { command: "bun run test:e2e -- e2e/agents-page.spec.ts", run_in_background: true } }
      expect(yield* hook("pre-tool-use", { ...call, hook_event_name: "PreToolUse" })).toEqual({ out: "", failure: null })
      expect(yield* tests).toMatchObject({ label: "web e2e", command: "bun run test:e2e -- e2e/agents-page.spec.ts", endedAt: null, background: false })
      yield* hook("post-tool-use", { ...call, hook_event_name: "PostToolUse", tool_response: { stdout: "", backgroundTaskId: "blo3xolgq" } })
      expect(yield* tests).toMatchObject({ endedAt: null, background: true })

      // The runner, in the repo, reports as the session.
      const file = path.join(repo, "progress.json")
      const progress = { stage: "web-e2e", passed: 6, failed: 1, skipped: 0, total: 13, current: "e2e/agents-page.spec.ts", failures: ["e2e/agents-page.spec.ts:40 › lists agents"], done: false, outcome: null, folder: null }
      fs.writeFileSync(file, JSON.stringify(progress))
      expect(yield* x("test", "progress", "--file", file)).toEqual({ out: "Reported.", failure: null })
      expect(yield* tests).toMatchObject({ endedAt: null, progress: { passed: 6, failed: 1, total: 13, failures: ["e2e/agents-page.spec.ts:40 › lists agents"] } })

      fs.writeFileSync(file, JSON.stringify({ ...progress, passed: 12, done: true, outcome: "failed", folder: path.join(repo, "test-results/docker/run-1") }))
      yield* x("test", "progress", "--file", file)
      expect(yield* tests).toMatchObject({ outcome: "failed", progress: { done: true, folder: path.join(repo, "test-results/docker/run-1") } })
      expect((yield* tests)?.endedAt).not.toBeNull()
      // Nothing running now: a report changes nothing, and says so; a broken file is an error.
      expect((yield* x("test", "progress", "--file", file, "--json")).out).toBe(JSON.stringify({ matched: false }, null, 2))
      fs.writeFileSync(file, "{")
      expect((yield* x("test", "progress", "--file", file)).failure).toContain("Can't read the progress in")
    }).pipe(Effect.scoped))

  it.live("a foreground run ends with its call: PostToolUse passed, PostToolUseFailure failed; other commands start nothing", () =>
    Effect.gen(function* () {
      const { hook, human, repo } = yield* setup
      const as = { session_id: X, agent_id: BUILDER, agent_type: "cello-builder", cwd: repo }
      const tests = Effect.map(human["snapshot.get"]({}), (s) => s.agents.find((a) => a.agentId === BUILDER)?.tests ?? null)
      yield* hook("post-tool-use", launch(BUILDER, "cello-builder", "CEL-1 agents on cards", "Build CEL-1"))
      yield* hook("pre-tool-use", { ...as, hook_event_name: "PreToolUse", tool_name: "Bash", tool_use_id: "t0", tool_input: { command: "bun run typecheck" } })
      expect(yield* tests).toBeNull()

      const unit = { ...as, tool_name: "Bash", tool_use_id: "t1", tool_input: { command: "bun run test -- apps/server" } }
      yield* hook("pre-tool-use", { ...unit, hook_event_name: "PreToolUse" })
      yield* hook("post-tool-use-failure", { ...unit, hook_event_name: "PostToolUseFailure", error: "Exit code 1" })
      expect(yield* tests).toMatchObject({ label: "unit tests", outcome: "failed" })
      yield* hook("pre-tool-use", { ...unit, tool_use_id: "t2", hook_event_name: "PreToolUse" })
      expect(yield* tests).toMatchObject({ endedAt: null, outcome: null })
      yield* hook("post-tool-use", { ...unit, tool_use_id: "t2", hook_event_name: "PostToolUse", tool_response: { stdout: "ok" } })
      expect(yield* tests).toMatchObject({ outcome: "passed" })
    }).pipe(Effect.scoped))
})

describe("a cello command carrying CELLO_AGENT", () => {
  it.live("is credited to that agent under the session: its comment, the last change, the history; claims stay on the session", () =>
    Effect.gen(function* () {
      const { hook, as, x } = yield* setup
      yield* hook("post-tool-use", launch(BUILDER, "cello-builder", "CEL-1 agents on cards", "Build CEL-1"))
      const builder = as(`cello-builder/${BUILDER}`)
      expect((yield* builder("task", "comment", "CEL-1", "Built; tests pass")).failure).toBeNull()
      yield* builder("task", "stage", "CEL-1", "review")

      const shown = (yield* x("task", "get", "CEL-1")).out
      const by = `cello-builder · ${BUILDER.slice(0, 8)} (under Claude Code session 2fd0505c)`
      expect(shown).toContain("Claimed by: Claude Code session 2fd0505c")
      expect(shown).toContain(`Last changed by ${by}`)
      expect(shown).toContain(`Subagents on it (1)\n  ${by}: working`)
      expect(shown).toMatch(new RegExp(`Comments \\(1\\)\\n  ${by.replace(/[()]/g, "\\$&")} · just now · id \\w+\\n    Built; tests pass`))
      expect(shown).toContain(`${by} set the stage to Agent review`)

      // The session still holds it: the orchestrator's own call (no CELLO_AGENT) sees it as its claim.
      expect((yield* x("task", "list", "--mine")).out).toContain("CEL-1")
      const who = JSON.parse((yield* builder("whoami")).out)
      expect(who.headers).toMatchObject({ "x-cello-agent": BUILDER, "x-cello-agent-type": "cello-builder" })
      expect(who.server.agent).toMatchObject({ agentId: BUILDER, agentType: "cello-builder" })
    }).pipe(Effect.scoped))
})

// CEL-90: Claude Code's allow rule Bash(cello:*) only matches commands that start with `cello`, so a
// subagent names itself with a flag instead of a CELLO_AGENT=… prefix.
describe("cello --agent", () => {
  it.live("does what CELLO_AGENT does: the comment, the stage and whoami are credited to the agent under the session", () =>
    Effect.gen(function* () {
      const { hook, x } = yield* setup
      yield* hook("post-tool-use", launch(BUILDER, "cello-builder", "CEL-1 agents on cards", "Build CEL-1"))
      const flagged = (...args: string[]) => x("--agent", `cello-builder/${BUILDER}`, ...args)
      expect((yield* flagged("task", "comment", "CEL-1", "Built; tests pass")).failure).toBeNull()
      yield* flagged("task", "stage", "CEL-1", "review")

      const shown = (yield* x("task", "get", "CEL-1")).out
      const by = `cello-builder · ${BUILDER.slice(0, 8)} (under Claude Code session 2fd0505c)`
      expect(shown).toContain("Claimed by: Claude Code session 2fd0505c")
      expect(shown).toContain(`Last changed by ${by}`)
      expect(shown).toMatch(new RegExp(`Comments \\(1\\)\\n  ${by.replace(/[()]/g, "\\$&")} · just now · id \\w+\\n    Built; tests pass`))
      expect(shown).toContain(`${by} set the stage to Agent review`)

      const who = JSON.parse((yield* flagged("whoami")).out)
      expect(who.variables).toMatchObject({ CELLO_AGENT: `cello-builder/${BUILDER}` })
      expect(who.headers).toMatchObject({ "x-cello-agent": BUILDER, "x-cello-agent-type": "cello-builder" })
      expect(who.server.agent).toMatchObject({ agentId: BUILDER, agentType: "cello-builder" })
    }).pipe(Effect.scoped))

  it.live("wins over a CELLO_AGENT in the environment, and refuses an empty value", () =>
    Effect.gen(function* () {
      const { as, x } = yield* setup
      const who = JSON.parse((yield* as("stale/x")("--agent", `cello-code-reviewer/${REVIEWER}`, "whoami")).out)
      expect(who.headers).toMatchObject({ "x-cello-agent": REVIEWER, "x-cello-agent-type": "cello-code-reviewer" })
      expect(yield* x("--agent", " ", "whoami")).toEqual({
        out: "",
        failure: "--agent needs the name SubagentStart gave you, as <type>/<id> (cello-builder/a13bfb89) or just the id.",
      })
    }).pipe(Effect.scoped))
})
