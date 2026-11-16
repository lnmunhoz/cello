// CEL-55 against a real server: subagents share their parent's session, so the Claude Code hooks and
// CELLO_AGENT say which one is working. A launch names its task; the subagent's tool calls check it in;
// SubagentStart hands it its CELLO_AGENT; a cello command carrying it is credited to it; SubagentStop
// ends it. Claims stay on the session.
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
