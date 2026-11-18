// CEL-107 against a real server: `cello agents` lists the agents working (an orchestrator session and the
// builder it launched, as the Claude Code hooks report them) and, with --all, the ones that finished
// today; `cello agents log <id>` prints an agent's log from its invented transcript in a temp Claude
// projects folder (the server reads `<dataDir>/claude/projects`, never ~/.claude), and with --follow
// keeps printing the steps appended to it, through a server restart. Nothing sleeps: each wait is for a
// line the command prints, or for the moment it says the server went away.
import * as fs from "node:fs"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { beforeAll, describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Scope from "effect/Scope"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo } from "./cli.ts"

const X = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const BUILDER = "a13bfb89c0de1234f"
const KEY = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"

const line = (value: object) => `${JSON.stringify(value)}\n`
const said = (uuid: string, text: string, second = 0) =>
  line({ type: "assistant", uuid, timestamp: `2026-11-16T09:00:${String(second).padStart(2, "0")}.000Z`, message: { id: uuid, content: [{ type: "text", text }] } })
const call = (uuid: string, id: string, command: string, second: number, description?: string) =>
  line({
    type: "assistant",
    uuid,
    timestamp: `2026-11-16T09:00:${String(second).padStart(2, "0")}.000Z`,
    message: { id: uuid, content: [{ type: "tool_use", id, name: "Bash", input: { command, ...(description ? { description } : {}) } }] },
  })
const result = (uuid: string, id: string, content: string, second: number, isError = false) =>
  line({ type: "user", uuid, timestamp: `2026-11-16T09:00:${String(second).padStart(2, "0")}.000Z`, message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } })

/** Lines a command prints as it prints them, and a way to await one that contains `text`. */
const listener = () => {
  const lines: string[] = []
  const waiting: Array<{ text: string; resolve: () => void }> = []
  return {
    lines,
    onOut: (chunk: string) => {
      for (const l of chunk.split("\n")) {
        lines.push(l)
        for (const w of waiting.filter((w) => l.includes(w.text))) {
          waiting.splice(waiting.indexOf(w), 1)
          w.resolve()
        }
      }
    },
    printed: (text: string) =>
      Effect.promise(() => lines.some((l) => l.includes(text)) ? Promise.resolve() : new Promise<void>((resolve) => waiting.push({ text, resolve }))),
  }
}

/**
 * Project CEL; session X claimed CEL-1 and launched a builder on it, the hooks reporting both
 * transcripts, which Claude Code has written. The server can be stopped and started again.
 */
const seed = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const running = yield* Scope.make()
  yield* Effect.addFinalizer(() => Scope.close(running, Exit.void))
  const { port } = yield* startServer(dataDir).pipe(Scope.provide(running))
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port).pipe(Scope.provide(running))
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })

  const folder = path.join(dataDir, "claude", "projects", "-work-cello")
  const sessionFile = path.join(folder, `${X}.jsonl`)
  const builderFile = path.join(folder, X, "subagents", `agent-${BUILDER}.jsonl`)
  fs.mkdirSync(path.dirname(builderFile), { recursive: true })
  fs.writeFileSync(sessionFile, said("o1", "Launching a builder for CEL-1."))
  fs.writeFileSync(builderFile, [
    line({ type: "user", uuid: "b0", timestamp: "2026-11-16T09:00:00.000Z", message: { role: "user", content: "Build CEL-1, test first." } }),
    said("b1", "Reading AGENTS.md first.", 1),
    call("b2", "toolu_1", "bun run test", 2, "Run the tests"),
    result("b3", "toolu_1", ["FAIL src/timer.test.ts", "  flips after 90 seconds", "    at step 1", "    at step 2", `export GITHUB_TOKEN=${KEY}`].join("\n"), 4, true),
  ].join(""))

  const x = cello({ port, env: { CLAUDE_CODE_SESSION_ID: X, CLAUDE_PID: String(process.pid) }, cwd: repo })
  const hook = (event: string, input: Record<string, unknown>) =>
    cello({ port, env: {}, cwd: repo, stdin: JSON.stringify({ session_id: X, transcript_path: sessionFile, ...input }) })("hook", "claude", event)
  yield* x("task", "create", "Pancake timer")
  yield* x("task", "claim", "CEL-1")
  yield* hook("subagent-start", { hook_event_name: "SubagentStart", agent_id: BUILDER, agent_type: "cello-builder" })
  yield* hook("post-tool-use", {
    hook_event_name: "PostToolUse", tool_name: "Agent", tool_use_id: "toolu_launch",
    tool_input: { subagent_type: "cello-builder", description: "CEL-1 pancake timer", prompt: "Build CEL-1." },
    tool_response: { agentId: BUILDER, status: "async_launched" },
  })
  yield* hook("post-tool-use", { hook_event_name: "PostToolUse", agent_id: BUILDER, agent_type: "cello-builder", tool_name: "Bash", tool_input: { command: "bun run test" } })

  return {
    port,
    repo,
    builderFile,
    hook,
    /** `cello` as the human (no agent session in the environment). */
    me: cello({ port, env: {}, cwd: repo }),
    x,
    /** Runs `cello …args` as the human in a fiber, its stdout lines heard as they're printed. */
    start: (args: ReadonlyArray<string>) =>
      Effect.gen(function* () {
        const out = listener()
        let heard = () => {}
        const away = new Promise<void>((resolve) => (heard = resolve))
        const onErr = (l: string) => l.startsWith("The Cello server on port") && heard()
        const fiber = yield* Effect.forkChild(cello({ port, env: {}, cwd: repo, onOut: out.onOut, onErr })(...args))
        return { fiber, out, wentAway: Effect.raceFirst(Effect.promise(() => away), Effect.asVoid(Fiber.await(fiber))) }
      }),
    stopServer: Scope.close(running, Exit.void),
    restart: startServer(dataDir, { port }),
  }
})

/**
 * One seeded server for the whole file: a server and its seed per test outlasted Vitest's 5 s on a
 * loaded machine (CEL-121). The tests use it in order: the first finishes the builder, the --follow
 * tests append to its transcript, and the last one restarts the server, so it stays last.
 */
let world: Effect.Success<typeof seed>
beforeAll(() => Effect.map(seed, (seeded) => void (world = seeded)))
const setup = Effect.sync(() => world)

describe("cello agents (CEL-107)", () => {
  it.live("lists the session working and the builder under it, with their tasks and what each is doing; --all adds the ones that finished today", () =>
    Effect.gen(function* () {
      const { me, hook } = yield* setup
      const listed = yield* me("agents")
      expect(listed.failure).toBeNull()
      expect(listed.out).toMatch(/^Agents working \(2\):\n  Claude Code session 2fd0505c +orchestrator +active now +holds CEL-1 +Agent · cello-builder: CEL-1 pancake timer\n    cello-builder\/a13bfb89 +active now +on CEL-1 +Bash · bun run test\n/)
      expect(listed.out).toContain("`cello agents log <id>` prints one's log")

      // The builder finishes: it leaves the working list for Finished today.
      yield* hook("subagent-stop", { hook_event_name: "SubagentStop", agent_id: BUILDER, agent_type: "cello-builder" })
      const after = yield* me("agents")
      expect(after.out).not.toContain("    cello-builder/a13bfb89")
      expect(after.out).toContain("1 agent finished today: `cello agents --all` lists them.")
      expect((yield* me("agents", "--all")).out).toMatch(/\nFinished today \(1\):\n  cello-builder\/a13bfb89 under 2fd0505c +finished \d\d:\d\d +on CEL-1\n/)

      const json = JSON.parse((yield* me("agents", "--all", "--json")).out) as { working: Array<{ session: { externalId: string } }>; finished: Array<{ agent: { agentId: string } }> }
      expect(json.working.map((w) => w.session.externalId)).toEqual([X])
      expect(json.finished.map((f) => f.agent.agentId)).toEqual([BUILDER])
    }).pipe(Effect.scoped))
})

describe("cello agents log (CEL-107)", () => {
  it.live("prints the builder's steps from its transcript: the prompt, what it said, the failed call folded to its first lines; keys masked", () =>
    Effect.gen(function* () {
      const { me, x } = yield* setup
      const printed = yield* me("agents", "log", "a13bfb89")
      expect(printed.failure).toBeNull()
      const lines = printed.out.split("\n").map((l) => l.replace(/^\d\d:\d\d:\d\d/, "HH:MM:SS"))
      expect(lines).toEqual([
        "HH:MM:SS  Prompt  Build CEL-1, test first.",
        "HH:MM:SS  Said    Reading AGENTS.md first.",
        // Claude's description of the command, not the command (CEL-170).
        "HH:MM:SS  ✗ Bash · Run the tests  2.0 s",
        "            FAIL src/timer.test.ts",
        "              flips after 90 seconds",
        "                at step 1",
        "            … 2 more lines (--full shows them)",
      ])
      // The same agent by its type and id; --full shows the whole result, the key masked, and the command above it.
      const full = yield* me("agents", "log", "cello-builder/a13bfb89", "--full")
      expect(full.out).toContain("  ✗ Bash · Run the tests  2.0 s\n            $ bun run test\n            FAIL src/timer.test.ts")
      expect(printed.out).not.toContain("$ bun run test")
      expect(full.out).toContain("GITHUB_TOKEN=ghp_••••••••")
      expect(full.out).not.toContain(KEY)
      // The human may ask to see it; an agent asking still gets it masked.
      expect((yield* me("agents", "log", "a13bfb89", "--full", "--show-secrets")).out).toContain(KEY)
      const agentAsked = yield* x("agents", "log", "a13bfb89", "--full", "--show-secrets")
      expect(agentAsked.out).toContain("GITHUB_TOKEN=ghp_••••••••")
      expect(agentAsked.out).not.toContain(KEY)

      // The session by its short id.
      expect((yield* me("agents", "log", "2fd0505c")).out).toMatch(/Said +Launching a builder for CEL-1\.$/)
      // --json: the steps as the server sends them.
      const json = JSON.parse((yield* me("agents", "log", "a13bfb89", "--json")).out) as { steps: Array<{ id: string; kind: string }> }
      expect(json.steps.map((s) => s.kind)).toEqual(["user", "message", "tool"])
    }).pipe(Effect.scoped))

  it.live("an id matching nobody, or more than one, says so", () =>
    Effect.gen(function* () {
      const { me } = yield* setup
      expect((yield* me("agents", "log", "ffff")).failure).toBe("No agent or session starts with \"ffff\". `cello agents --all` lists them.")
      // The type has to match.
      expect((yield* me("agents", "log", "cello-code-reviewer/a13b")).failure).toContain("No agent or session starts with")
    }).pipe(Effect.scoped))

  it.live("--follow prints each step appended to the transcript as it's written", () =>
    Effect.gen(function* () {
      const { start, builderFile } = yield* setup
      const follow = yield* start(["agents", "log", "a13bfb89", "--follow"])
      yield* follow.out.printed("✗ Bash · Run the tests")
      fs.appendFileSync(builderFile, call("b4", "toolu_2", "bun run test src/timer.test.ts", 6))
      yield* follow.out.printed("▸ Bash · bun run test src/timer.test.ts  (running)")
      fs.appendFileSync(builderFile, result("b5", "toolu_2", "1 passed", 8))
      yield* follow.out.printed("✓ Bash · bun run test src/timer.test.ts  2.0 s")
      yield* follow.out.printed("1 passed")
      yield* Fiber.interrupt(follow.fiber)
    }).pipe(Effect.scoped))

  it.live("--follow rides out a server restart: it reconnects and prints only the steps it hadn't", () =>
    Effect.gen(function* () {
      const { start, builderFile, stopServer, restart, port } = yield* setup
      const follow = yield* start(["agents", "log", "a13bfb89", "--follow"])
      yield* follow.out.printed("✗ Bash · Run the tests")
      yield* stopServer
      yield* follow.wentAway
      yield* restart
      fs.appendFileSync(builderFile, said("b6", "Back after the restart.", 9))
      yield* follow.out.printed("Back after the restart.")
      yield* Fiber.interrupt(follow.fiber)
      // Each step once, though the new server sent the whole log again.
      expect(follow.out.lines.filter((l) => l.includes("Reading AGENTS.md first."))).toHaveLength(1)
      expect(follow.out.lines.filter((l) => l.includes("✗ Bash · Run the tests"))).toHaveLength(1)
      expect(port).toBeGreaterThan(0)
    }).pipe(Effect.scoped))
})
