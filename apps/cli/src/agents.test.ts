import type { LogStep } from "@cello/contract/agentLog"
import type { AgentSession, SessionAgent, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { agentId, agentsText, findAgent, logPrinter, stepLines } from "./agents.ts"

const MIN = 60_000
const now = new Date(2026, 10, 16, 15, 0, 0).getTime()
const at = (h: number, m: number, s = 0) => new Date(2026, 10, 16, h, m, s).getTime()

const session = (id: string, extra: Partial<AgentSession> = {}): AgentSession => ({
  id: `cello-${id}`, actorId: "claude", externalId: `${id}-417a-4167-acfe-2d66080fcae0`, clientName: "Claude Code", entrypoint: "cli", cwd: "/repo",
  pid: 1, startedAt: now - 60 * MIN, lastSeenAt: now - MIN, endedAt: null, ...extra,
})
const agent = (sessionId: string, id: string, extra: Partial<SessionAgent> = {}): SessionAgent => ({
  sessionId, agentId: id, agentType: "cello-builder", taskId: null, description: null, startedAt: now - 30 * MIN, lastSeenAt: now - MIN, endedAt: null,
  ...extra,
})
const task = (key: string) => ({ key, title: key }) as Task

const tool = (id: string, status: "running" | "ok" | "error", output = "", extra: Partial<LogStep> = {}): LogStep => ({
  id,
  kind: "tool",
  at: at(9, 0, 4),
  text: "Bash · bun run test",
  tool: { name: "Bash", status, durationMs: status === "running" ? null : 2500, output, lines: output.split("\n").length, cut: false },
  ...extra,
})

describe("findAgent: which agent `cello agents log <id>` means", () => {
  const orchestrator = session("2fd0505c")
  const other = session("2fe11111")
  const builder = agent(orchestrator.id, "a13bfb89c0de1234f")
  const reviewer = agent(orchestrator.id, "a1ff0000aa22bb33c", { agentType: "cello-code-reviewer" })
  const helper = agent(orchestrator.id, "2fd0aaaa11112222b", { agentType: null })
  const board = { sessions: [orchestrator, other], agents: [builder, reviewer, helper] }
  const find = (query: string) => findAgent(query, board)

  it("a session by the start of its host id; a subagent by the start of its id, with or without its type", () => {
    expect(find("2fd0505c")).toEqual({ _tag: "found", session: orchestrator, agent: null })
    expect(find("2fd0505c-417a-4167-acfe-2d66080fcae0")).toEqual({ _tag: "found", session: orchestrator, agent: null })
    expect(find("a13bfb89")).toEqual({ _tag: "found", session: orchestrator, agent: builder })
    expect(find("cello-builder/a13bfb89")).toEqual({ _tag: "found", session: orchestrator, agent: builder })
    expect(find("CELLO-BUILDER/a13b")).toEqual({ _tag: "found", session: orchestrator, agent: builder })
    // As `task get` and the board name it.
    expect(find("cello-builder · a13bfb89")).toEqual({ _tag: "found", session: orchestrator, agent: builder })
    // A subagent of unknown type is an "agent".
    expect(find("agent/2fd0aaaa")).toEqual({ _tag: "found", session: orchestrator, agent: helper })
  })

  it("an id that starts more than one says which, so a longer one can be given", () => {
    expect(find("a1")).toEqual({ _tag: "ambiguous", names: ["cello-builder/a13bfb89", "cello-code-reviewer/a1ff0000"] })
    expect(find("2f")).toEqual({ _tag: "ambiguous", names: ["Claude Code session 2fd0505c", "Claude Code session 2fe11111", "agent/2fd0aaaa"] })
  })

  it("the type has to match; nothing matching, or nothing given, is none", () => {
    expect(find("cello-code-reviewer/a13bfb89")).toEqual({ _tag: "none" })
    expect(find("ffff")).toEqual({ _tag: "none" })
    expect(find("  ")).toEqual({ _tag: "none" })
  })
})

describe("stepLines: one step of the log, as the terminal prints it", () => {
  const opts = { full: false, thinking: false }

  it("a finished tool call: time, ✓ or ✗, its line and how long it took; its result folded to the first lines", () => {
    const output = ["FAIL src/timer.test.ts", "  flips after 90 seconds", "    at step 1", "    at step 2", "    at step 3"].join("\n")
    expect(stepLines(tool("t1", "error", output), opts)).toEqual([
      "09:00:04  ✗ Bash · bun run test  2.5 s",
      "            FAIL src/timer.test.ts",
      "              flips after 90 seconds",
      "                at step 1",
      "            … 2 more lines (--full shows them)",
    ])
    expect(stepLines(tool("t2", "ok", "1 passed"), opts)).toEqual(["09:00:04  ✓ Bash · bun run test  2.5 s", "            1 passed"])
    expect(stepLines(tool("t3", "ok", ""), opts)).toEqual(["09:00:04  ✓ Bash · bun run test  2.5 s"])
  })

  it("--full: the whole result, and where it was cut when the log carries only part", () => {
    const output = ["a", "b", "c", "d"].join("\n")
    expect(stepLines(tool("t1", "ok", output), { ...opts, full: true }).slice(1)).toEqual(["            a", "            b", "            c", "            d"])
    const cut = tool("t2", "ok", output, {})
    const long = { ...cut, tool: { ...cut.tool!, lines: 900, cut: true } }
    expect(stepLines(long, { ...opts, full: true }).at(-1)).toBe("            (cut at 4 of 900 lines; the rest is in the transcript)")
  })

  it("a call still running, a launch with its subagent, messages and prompts, a note; a step with no time leaves the time blank", () => {
    expect(stepLines(tool("t1", "running"), opts)).toEqual(["09:00:04  ▸ Bash · bun run test  (running)"])
    const launch: LogStep = { ...tool("l1", "ok", "Built it."), kind: "agent", text: "Agent · cello-builder: PAN-1", agentId: "a13bfb89c0de1234f" }
    expect(stepLines(launch, opts)).toEqual(["09:00:04  ✓ Agent · cello-builder: PAN-1  2.5 s  → a13bfb89", "            Built it."])
    expect(stepLines({ id: "m", kind: "message", at: at(9, 1), text: "Reading the rules.\nThen the test." }, opts)).toEqual([
      "09:01:00  Said    Reading the rules.",
      "                  Then the test.",
    ])
    expect(stepLines({ id: "u", kind: "user", at: at(9, 0), text: "Build PAN-1." }, opts)).toEqual(["09:00:00  Prompt  Build PAN-1."])
    expect(stepLines({ id: "s", kind: "system", at: null, text: "Woken run started" }, opts)).toEqual(["          Note    Woken run started"])
  })

  it("thinking only with --thinking, folded like a result", () => {
    const thought: LogStep = { id: "th", kind: "thinking", at: at(9, 0, 2), text: "First the test.\nThen the code.\nThen the docs.\nThen the video." }
    expect(stepLines(thought, opts)).toEqual([])
    expect(stepLines(thought, { ...opts, thinking: true })).toEqual([
      "09:00:02  Thinking",
      "            First the test.",
      "            Then the code.",
      "            Then the docs.",
      "            … 1 more line (--full shows them)",
    ])
  })
})

describe("logPrinter: the log as it arrives, each step printed once", () => {
  it("a call is printed when it starts and again when it finishes; a first batch sent again (a reconnect) prints nothing new", () => {
    const printer = logPrinter({ full: false, thinking: false })
    const said: LogStep = { id: "m1", kind: "message", at: at(9, 0), text: "Running the tests." }
    expect(printer.steps({ _tag: "steps", reset: true, skipped: 0, steps: [said, tool("t1", "running")] })).toEqual([
      "09:00:00  Said    Running the tests.",
      "09:00:04  ▸ Bash · bun run test  (running)",
    ])
    expect(printer.steps({ _tag: "steps", reset: false, skipped: 0, steps: [tool("t1", "ok", "1 passed")] })).toEqual([
      "09:00:04  ✓ Bash · bun run test  2.5 s",
      "            1 passed",
    ])
    // The server restarted: its first batch has everything again, and one new step.
    const next: LogStep = { id: "m2", kind: "message", at: at(9, 1), text: "Committing." }
    expect(printer.steps({ _tag: "steps", reset: true, skipped: 0, steps: [said, tool("t1", "ok", "1 passed"), next] })).toEqual([
      "09:01:00  Said    Committing.",
    ])
  })

  it("says once when earlier steps were left out", () => {
    const printer = logPrinter({ full: false, thinking: false })
    const said: LogStep = { id: "m1", kind: "message", at: at(9, 0), text: "Hi." }
    expect(printer.steps({ _tag: "steps", reset: true, skipped: 12, steps: [said] })).toEqual(["(12 earlier steps aren't shown)", "09:00:00  Said    Hi."])
    expect(printer.steps({ _tag: "steps", reset: true, skipped: 0, older: true, steps: [] })).toEqual([])
    expect(logPrinter(opts()).steps({ _tag: "steps", reset: true, skipped: 0, older: true, steps: [] })).toEqual([
      "(Earlier steps aren't shown: this log is long, so it starts near its end)",
    ])
  })
})

const opts = () => ({ full: false, thinking: false })

describe("agentsText: what `cello agents` prints", () => {
  const orchestrator = session("2fd0505c", { currentStep: "Agent · cello-builder: CEL-7" })
  const builder = agent(orchestrator.id, "a13bfb89c0de1234f", { currentStep: "Bash · bun run test" })
  const reviewer = agent(orchestrator.id, "b77d0e11aa22bb33c", { agentType: "cello-code-reviewer", lastSeenAt: now - 12 * MIN, currentStep: "Read · x.ts" })
  const working = [{
    session: orchestrator,
    presence: "active" as const,
    tasks: [task("CEL-7"), task("CEL-8")],
    agents: [
      { agent: builder, presence: "active" as const, task: task("CEL-7") },
      { agent: reviewer, presence: "idle" as const, task: task("CEL-8") },
    ],
  }]
  const done = agent(orchestrator.id, "c0ffee00aa11bb22c", { endedAt: at(14, 2) })
  const finished = [
    { session: orchestrator, agent: done, endedAt: at(14, 2), tasks: [task("CEL-6")] },
    { session: session("9a8b7c6d", { endedAt: at(11, 30) }), agent: null, endedAt: at(11, 30), tasks: [] },
  ]

  it("each session working, its subagents under it: id, role, presence, tasks, and what it's doing right now", () => {
    expect(agentsText({ working, finished, all: false, now })).toBe([
      "Agents working (3):",
      "  Claude Code session 2fd0505c    orchestrator  active now    holds CEL-7, CEL-8  Agent · cello-builder: CEL-7",
      "    cello-builder/a13bfb89                      active now    on CEL-7            Bash · bun run test",
      "    cello-code-reviewer/b77d0e11                seen 12m ago  on CEL-8",
      "",
      "2 agents finished today: `cello agents --all` lists them.",
      "`cello agents log <id>` prints one's log: a session's short id (2fd0505c) or a subagent's (cello-builder/a13bfb89).",
    ].join("\n"))
  })

  it("--all lists the ones that finished today, newest first", () => {
    expect(agentsText({ working: [], finished, all: true, now })).toBe([
      "No agent is working.",
      "",
      "Finished today (2):",
      "  cello-builder/c0ffee00 under 2fd0505c  finished 14:02  on CEL-6",
      "  Claude Code session 9a8b7c6d           finished 11:30",
      "`cello agents log <id>` prints one's log: a session's short id (2fd0505c) or a subagent's (cello-builder/a13bfb89).",
    ].join("\n"))
  })
})

describe("agentId", () => {
  it("<type>/<first 8 of the id>, as --agent and `cello agents log` take it", () => {
    expect(agentId({ agentId: "a13bfb89c0de1234f", agentType: "cello-builder" })).toBe("cello-builder/a13bfb89")
    expect(agentId({ agentId: "a13bfb89c0de1234f", agentType: null })).toBe("agent/a13bfb89")
  })
})
