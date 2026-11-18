import type { LogStep } from "@cello/contract/agentLog"
import type { AgentSession, SessionAgent } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import {
  applyLogUpdate,
  currentStepOf,
  doingNowOf,
  durationWords,
  EMPTY_LOG,
  filterSteps,
  groupStartsOpen,
  logKey,
  parseLogKey,
  previewOf,
  storyKey,
  storyOf,
  storySteps,
  thinkingNote,
  unavailableWords,
  workedWords,
} from "./agentLog.ts"

const message = (id: string, text: string): LogStep => ({ id, kind: "message", at: 1, text })
const tool = (id: string, status: "running" | "ok" | "error"): LogStep => ({
  id,
  kind: "tool",
  at: 2,
  text: "Bash · bun run test",
  tool: { name: "Bash", status, durationMs: status === "running" ? null : 1200, output: "", lines: 0, cut: false },
})

describe("applyLogUpdate", () => {
  it("the first batch replaces what was shown; later ones add steps and replace a step sent again by id, in place", () => {
    let log = applyLogUpdate(EMPTY_LOG, { _tag: "steps", reset: true, skipped: 3, steps: [message("m1", "Starting.")] })
    expect(log).toEqual({ status: "ready", reason: null, skipped: 3, older: false, arrived: [], unsavedThinking: 0, steps: [message("m1", "Starting.")] })
    log = applyLogUpdate(log, { _tag: "steps", reset: false, skipped: 0, steps: [tool("t1", "running"), message("m2", "Waiting.")] })
    log = applyLogUpdate(log, { _tag: "steps", reset: false, skipped: 0, steps: [tool("t1", "error")] })
    expect(log.steps.map((s) => [s.id, s.tool?.status])).toEqual([["m1", undefined], ["t1", "error"], ["m2", undefined]])
    expect(log.skipped).toBe(3)
    expect(applyLogUpdate(EMPTY_LOG, { _tag: "steps", reset: true, skipped: 0, older: true, steps: [] }).older).toBe(true)
    const again = applyLogUpdate(log, { _tag: "steps", reset: true, skipped: 0, steps: [message("x", "Over.")] })
    expect(again.steps).toEqual([message("x", "Over.")])
  })

  it("unavailable keeps nothing and says why", () => {
    const log = applyLogUpdate(applyLogUpdate(EMPTY_LOG, { _tag: "steps", reset: true, skipped: 0, steps: [message("m1", "a")] }), {
      _tag: "unavailable",
      reason: "missing",
    })
    expect(log).toEqual({ status: "unavailable", reason: "missing", skipped: 0, older: false, arrived: [], unsavedThinking: 0, steps: [] })
  })

  it("keeps how many thoughts Claude Code saved without words: a reset takes the count, a later update only changes it when it sends one (CEL-170)", () => {
    let log = applyLogUpdate(EMPTY_LOG, { _tag: "steps", reset: true, skipped: 0, steps: [message("m1", "a")], unsavedThinking: 2 })
    expect(log.unsavedThinking).toBe(2)
    log = applyLogUpdate(log, { _tag: "steps", reset: false, skipped: 0, steps: [message("m2", "b")] })
    expect(log.unsavedThinking).toBe(2)
    log = applyLogUpdate(log, { _tag: "steps", reset: false, skipped: 0, steps: [], unsavedThinking: 3 })
    expect(log.unsavedThinking).toBe(3)
    expect(applyLogUpdate(log, { _tag: "steps", reset: true, skipped: 0, steps: [] }).unsavedThinking).toBe(0)
  })

  it("marks the steps that just arrived live (CEL-107): not the first batch, a reset or a step updated in place", () => {
    let log = applyLogUpdate(EMPTY_LOG, { _tag: "steps", reset: true, skipped: 0, steps: [message("m1", "Starting."), tool("t1", "running")] })
    expect(log.arrived).toEqual([])
    log = applyLogUpdate(log, { _tag: "steps", reset: false, skipped: 0, steps: [message("m2", "Next."), message("m3", "Then.")] })
    expect(log.arrived).toEqual(["m2", "m3"])
    // The running call gets its result, and one new step comes with it: only the new one arrived.
    log = applyLogUpdate(log, { _tag: "steps", reset: false, skipped: 0, steps: [tool("t1", "ok"), message("m4", "Done.")] })
    expect(log.arrived).toEqual(["m4"])
    log = applyLogUpdate(log, { _tag: "steps", reset: false, skipped: 0, steps: [tool("t1", "error")] })
    expect(log.arrived).toEqual([])
    // A reconnect's first batch replaces everything: nothing arrives.
    log = applyLogUpdate(log, { _tag: "steps", reset: true, skipped: 0, steps: [message("m1", "Starting."), message("m5", "New.")] })
    expect(log.arrived).toEqual([])
  })
})

describe("filterSteps", () => {
  const steps: LogStep[] = [
    { id: "u", kind: "user", at: 0, text: "Build it" },
    message("m", "On it."),
    { id: "th", kind: "thinking", at: 0, text: "Hmm." },
    tool("ok", "ok"),
    tool("bad", "error"),
    { id: "ag", kind: "agent", at: 0, text: "Agent · x", tool: { ...tool("ag", "error").tool! }, agentId: null },
    { id: "sys", kind: "system", at: 0, text: "The run ended: failed (boom)" },
  ]
  const ids = (show: Parameters<typeof filterSteps>[1], thinking: boolean) => filterSteps(steps, show, thinking).map((s) => s.id)

  it("everything and errors; thinking only with its switch on, and never among errors", () => {
    expect(ids("everything", false)).toEqual(["u", "m", "ok", "bad", "ag", "sys"])
    expect(ids("everything", true)).toEqual(["u", "m", "th", "ok", "bad", "ag", "sys"])
    expect(ids("errors", true)).toEqual(["bad", "ag"])
  })
})

describe("thinkingNote", () => {
  const unsaved = { ...EMPTY_LOG, status: "ready" as const, unsavedThinking: 3 }

  it("says Claude Code saved the thinking without its words, and what turns that on, only when it saved some and none shows (CEL-170)", () => {
    expect(thinkingNote(unsaved)).toContain("showThinkingSummaries")
    expect(thinkingNote(unsaved)).toContain("~/.claude/settings.json")
    expect(thinkingNote({ ...unsaved, steps: [{ id: "th", kind: "thinking", at: 0, text: "A saved thought." }] })).toBeNull()
    expect(thinkingNote({ ...unsaved, unsavedThinking: 0 })).toBeNull()
  })
})

describe("logKey", () => {
  it("round-trips whose log it is", () => {
    for (const source of [{ sessionId: "s1" }, { sessionId: "s1", agentId: "a1" }, { sessionId: "s1", runId: "r1", reveal: true }]) {
      expect(parseLogKey(logKey(source))).toEqual({ agentId: undefined, runId: undefined, reveal: false, ...source })
    }
  })
})

describe("durationWords", () => {
  it.each([
    [null, ""],
    [40, "40 ms"],
    [2500, "2.5 s"],
    [12_400, "12 s"],
    [95_000, "1 min 35 s"],
    [3_600_000, "60 min"],
  ])("%j → %j", (ms, words) => expect(durationWords(ms)).toBe(words))
})

describe("previewOf", () => {
  it("the first lines of a result, and how many more there are", () => {
    const output = Array.from({ length: 250 }, (_, i) => `l${i}`).join("\n")
    expect(previewOf(output, 200)).toEqual({ text: output.split("\n").slice(0, 200).join("\n"), more: 50 })
    expect(previewOf("a\nb", 200)).toEqual({ text: "a\nb", more: 0 })
  })
})

describe("unavailableWords", () => {
  it("says why there's no log, in the agent's situation, never naming anyone", () => {
    expect(unavailableWords("missing", true)).toBe("This log isn't on disk yet. It shows up here as soon as Claude Code writes it.")
    expect(unavailableWords("missing", false)).toBe("This log is no longer on disk.")
    expect(unavailableWords("none", true)).toContain("cello install claude")
    expect(unavailableWords("refused", false)).toContain("outside Claude Code's projects folder")
    expect(unavailableWords("unreadable", true)).toBe("Cello couldn't read this log file.")
  })
})

describe("currentStepOf", () => {
  const session = { currentStep: "Agent · cello-builder: PAN-1" } as AgentSession
  const agent = { currentStep: "Bash · bun run test" } as SessionAgent
  it("the agent's or the session's last step, only while it's working", () => {
    expect(currentStepOf({ presence: "active", session, agent })).toBe("Bash · bun run test")
    expect(currentStepOf({ presence: "active", session, agent: null })).toBe("Agent · cello-builder: PAN-1")
    expect(currentStepOf({ presence: "idle", session, agent })).toBeNull()
    expect(currentStepOf({ presence: "ended", session, agent })).toBeNull()
  })

  it("doingNowOf: a run that runs says where it is, before the step or what it waits on (CEL-134)", () => {
    const tests = { label: "web e2e", command: "bun run test:e2e", startedAt: 0, endedAt: null, outcome: null, background: true,
      progress: { stage: "web-e2e", passed: 6, failed: 1, skipped: 0, total: 13, current: null, failures: [], done: false, outcome: null, folder: null } }
    const running = { ...agent, tests, waitingOn: ["Bash · bun run test:e2e"] }
    expect(doingNowOf({ presence: "idle", session, agent: running }, 192_000)).toBe("Running tests: web e2e 7 of 13 · 1 failed · 3m12s")
    expect(doingNowOf({ presence: "active", session, agent: { ...running, tests: { ...tests, endedAt: 9, outcome: "passed" as const } } }, 192_000))
      .toBe("Waiting on background work: Bash · bun run test:e2e")
    expect(doingNowOf({ presence: "active", session, agent }, 0)).toBe("Bash · bun run test")
  })

  it("a subagent waiting on its own background work says what it waits on, quiet or not (CEL-133)", () => {
    const waiting = { ...agent, waitingOn: ["Bash · bun run test:e2e", "Monitor · e2e finishing"] }
    expect(currentStepOf({ presence: "idle", session, agent: waiting })).toBe("Waiting on background work: Bash · bun run test:e2e, Monitor · e2e finishing")
    expect(currentStepOf({ presence: "active", session, agent: waiting })).toBe("Waiting on background work: Bash · bun run test:e2e, Monitor · e2e finishing")
    expect(currentStepOf({ presence: "ended", session, agent: waiting })).toBeNull()
  })
})

// The Story view (CEL-170).
const AT = Date.parse("2026-11-18T09:00:00.000Z")
const sec = (n: number) => AT + n * 1000

const prompt = (id: string, text: string, at = 0): LogStep => ({ id, kind: "user", at: sec(at), text })
const said = (id: string, text: string, at: number, endsTurn = false): LogStep => ({ id, kind: "message", at: sec(at), text, ...(endsTurn ? { endsTurn: true } : {}) })
const thought = (id: string, at: number): LogStep => ({ id, kind: "thinking", at: sec(at), text: "Hmm." })
const note = (id: string, at: number): LogStep => ({ id, kind: "system", at: sec(at), text: "A background task finished" })
const call = (id: string, name: string, target: string, at: number, status: "running" | "ok" | "error" = "ok", took = 1000): LogStep => ({
  id,
  kind: "tool",
  at: sec(at),
  text: `${name} · ${target}`,
  tool: { name, status, durationMs: status === "running" ? null : took, output: "", lines: 0, cut: false },
})
const launch = (id: string, at: number): LogStep => ({
  id,
  kind: "agent",
  at: sec(at),
  text: "Agent · cello-builder: build it",
  tool: { name: "Agent", status: "ok", durationMs: 500, output: "", lines: 0, cut: false },
  agentId: "a1",
})

/** A story as ids, so a test reads at a glance: a group or a turn is `[id, ...what's inside]`, a live row `live:<id>`. */
type Shape = string | [string, ...Shape[]]
const shape = (items: ReturnType<typeof storyOf>): Shape[] =>
  items.map((item) => {
    if (item._tag === "step") return item.step.id
    if (item._tag === "live") return `live:${item.step.id}`
    if (item._tag === "group") return [item.id, ...item.steps.map((s) => s.id)]
    return [item.id, ...shape(item.items)]
  })

describe("storyOf", () => {
  const open = { thinking: false, live: true }
  const idle = { thinking: false, live: false }

  it("folds the calls between two messages into a group, and anything else breaks the run", () => {
    const steps = [
      prompt("u", "Go"),
      said("m1", "Looking.", 1),
      call("c1", "Read", "a.ts", 2),
      call("c2", "Bash", "Run", 3),
      call("c3", "Bash", "Run", 4),
      said("m2", "Found it.", 5),
      call("c4", "Edit", "a.ts", 6),
      call("c5", "Edit", "b.ts", 7),
      launch("ag", 8),
      call("c6", "Read", "c.ts", 9),
      call("c7", "Read", "d.ts", 10),
      note("sys", 11),
    ]
    expect(shape(storyOf(steps, open))).toEqual(["u", "m1", ["group:c1", "c1", "c2", "c3"], "m2", ["group:c4", "c4", "c5"], "ag", ["group:c6", "c6", "c7"], "sys"])
  })

  it("leaves a lone call as its own row, not a group of one", () => {
    const steps = [prompt("u", "Go"), call("c1", "Bash", "Run", 1), said("m1", "Hm.", 2), call("c2", "Read", "a.ts", 3), call("c3", "Read", "b.ts", 4)]
    expect(shape(storyOf(steps, open))).toEqual(["u", "c1", "m1", ["group:c2", "c2", "c3"]])
  })

  it("words a group by what its calls did, in order of first appearance, counting each file once", () => {
    const steps = [
      call("r1", "Read", "a.ts", 0),
      call("b1", "Bash", "Run", 1),
      call("r2", "Read", "a.ts", 2),
      call("r3", "Read", "b.ts", 3),
      call("e1", "Edit", "a.ts", 4),
      call("e2", "Write", "a.ts", 5),
      call("g1", "Grep", "x", 6),
      call("g2", "Glob", "*.ts", 7),
      call("w1", "WebFetch", "docs", 8),
      call("o1", "Skill", "cello:cello", 9),
    ]
    expect(storyOf(steps, open)[0]).toMatchObject({
      _tag: "group",
      calls: 10,
      summary: "Read 2 files, ran 1 command, edited 1 file, searched 2 times, browsed the web 1 time, used 1 other tool",
    })
    expect(storyOf([call("b1", "Bash", "Run", 0), call("b2", "Bash", "Run", 1), call("b3", "Bash", "Run", 2)], open)[0]).toMatchObject({ summary: "Ran 3 commands" })
    // Only unknown tools: not "other".
    expect(storyOf([call("o1", "Skill", "x", 0), call("o2", "TodoWrite", "", 1)], open)[0]).toMatchObject({ summary: "Used 2 tools" })
  })

  it("gives a group its time span, from the first call to the last result, and how many failed", () => {
    const steps = [call("c1", "Bash", "Run", 0, "ok", 2000), call("c2", "Bash", "Run", 10, "error", 5000), call("c3", "Bash", "Run", 4, "ok", 1000)]
    expect(storyOf(steps, open)[0]).toMatchObject({ failed: 1, durationMs: 15_000 })
    const unknown: LogStep[] = [
      { ...call("c1", "Bash", "Run", 0), at: null },
      { ...call("c2", "Bash", "Run", 0), at: null },
    ]
    expect(storyOf(unknown, open)[0]).toMatchObject({ durationMs: null })
  })

  it("shows a call that's still running as its own live row after its group, only while the agent works, only in the open turn's last run", () => {
    const steps = [prompt("u", "Go"), call("c1", "Bash", "Run", 1), call("c2", "Bash", "Run", 2), call("c3", "Bash", "Run", 3, "running")]
    expect(shape(storyOf(steps, open))).toEqual(["u", ["group:c1", "c1", "c2"], "live:c3"])
    // The agent isn't working: the running call stays in its group (an interrupted call never got a result).
    expect(shape(storyOf(steps, idle))).toEqual(["u", ["turn:c1", ["group:c1", "c1", "c2", "c3"]]])
    // A lone running call is live too; the one before it stays a lone row.
    expect(shape(storyOf([prompt("u", "Go"), call("c1", "Bash", "Run", 1), call("c2", "Bash", "Run", 2, "running")], open))).toEqual(["u", "c1", "live:c2"])
    expect(shape(storyOf([prompt("u", "Go"), call("c1", "Bash", "Run", 1, "running")], open))).toEqual(["u", "live:c1"])
    // An earlier run's call that never ended stays in its group, even while the agent works.
    const earlier = [prompt("u", "Go"), call("c1", "Bash", "Run", 1), call("c2", "Bash", "Run", 2, "running"), said("m1", "Moving on.", 3), call("c3", "Bash", "Run", 4, "running")]
    expect(shape(storyOf(earlier, open))).toEqual(["u", ["group:c1", "c1", "c2"], "m1", "live:c3"])
    // Calls made in parallel each get a row.
    expect(shape(storyOf([prompt("u", "Go"), call("c1", "Read", "a", 1, "running"), call("c2", "Read", "b", 1, "running")], open))).toEqual(["u", "live:c1", "live:c2"])
  })

  it("folds a turn that ended with its answer: the prompt, the work under one row, then the answer", () => {
    const steps = [prompt("u", "Go"), said("m1", "Looking.", 1), call("c1", "Bash", "Run", 2), call("c2", "Bash", "Run", 3), said("m2", "All done.", 252, true)]
    const story = storyOf(steps, open)
    expect(shape(story)).toEqual(["u", ["turn:m1", "m1", ["group:c1", "c1", "c2"]], "m2"])
    expect(story[1]).toMatchObject({ _tag: "turn", durationMs: 252_000 })
    expect(workedWords(252_000)).toBe("Worked for 4 min 12 s")
    expect(workedWords(null)).toBe("Worked")
  })

  it("ends a turn at the next prompt: its work folds up to its last message, what comes after stays out", () => {
    const steps = [prompt("u1", "One"), call("c1", "Bash", "Run", 1), said("m1", "Partial.", 2), call("c2", "Read", "a", 3), call("c3", "Read", "b", 4), prompt("u2", "Two", 5), call("c4", "Bash", "Run", 6)]
    // The second turn is open: flat, its lone call a row.
    expect(shape(storyOf(steps, open))).toEqual(["u1", ["turn:c1", "c1"], "m1", ["group:c2", "c2", "c3"], "u2", "c4"])
  })

  it("ends the last turn when the agent isn't working, with no answer: all its work folds, to the last result", () => {
    const steps = [prompt("u", "Go"), call("c1", "Bash", "Run", 1), call("c2", "Bash", "Run", 3)]
    const story = storyOf(steps, idle)
    expect(shape(story)).toEqual(["u", ["turn:c1", ["group:c1", "c1", "c2"]]])
    expect(story[1]).toMatchObject({ durationMs: 4000 })
  })

  it("keeps a turn that is only talk flat, and an open turn flat", () => {
    expect(shape(storyOf([prompt("u", "Hi"), said("m", "Hello.", 1, true)], open))).toEqual(["u", "m"])
    expect(shape(storyOf([prompt("u", "Go"), said("m1", "Looking.", 1), call("c1", "Bash", "Run", 2), call("c2", "Bash", "Run", 3)], open))).toEqual([
      "u",
      "m1",
      ["group:c1", "c1", "c2"],
    ])
  })

  it("starts a new turn after an answer even without a prompt, flat while the agent works", () => {
    const steps = [prompt("u", "Go"), call("c1", "Bash", "Run", 1), said("m1", "Done.", 2, true), note("sys", 3), call("c2", "Bash", "Run", 4, "running")]
    expect(shape(storyOf(steps, open))).toEqual(["u", ["turn:c1", "c1"], "m1", "sys", "live:c2"])
  })

  it("shows thoughts in a run only with the switch on, and never counts them as calls", () => {
    const steps = [prompt("u", "Go"), thought("t1", 1), call("c1", "Bash", "Run", 2), thought("t2", 3), call("c2", "Bash", "Run", 4), said("m", "Done.", 5), thought("t3", 6)]
    const on = { thinking: true, live: true }
    expect(shape(storyOf(steps, on))).toEqual(["u", ["group:t1", "t1", "c1", "t2", "c2"], "m", "t3"])
    expect(storyOf(steps, on)[1]).toMatchObject({ calls: 2 })
    // Off: they're gone, and don't break the run.
    expect(shape(storyOf(steps, open))).toEqual(["u", ["group:c1", "c1", "c2"], "m"])
    // A thought and one call: not enough calls for a group.
    expect(shape(storyOf([thought("t1", 1), call("c1", "Bash", "Run", 2)], on))).toEqual(["t1", "c1"])
  })

  it("keeps group and turn ids as steps append, so an opened one stays open", () => {
    const base = [prompt("u", "Go"), call("c1", "Bash", "Run", 1), call("c2", "Bash", "Run", 2)]
    const grown = [...base, call("c3", "Bash", "Run", 3), call("c4", "Read", "a", 4)]
    const group = (steps: LogStep[]) => storyOf(steps, open).find((i) => i._tag === "group")
    expect(group(base)).toMatchObject({ id: "group:c1", calls: 2 })
    expect(group(grown)).toMatchObject({ id: "group:c1", calls: 4 })
    const ended = [...grown, said("m", "Done.", 9, true)]
    expect(storyOf(ended, open).find((i) => i._tag === "turn")).toMatchObject({ id: "turn:c1" })
    expect(storyOf([...ended, said("m2", "More.", 10)], open).find((i) => i._tag === "turn")).toMatchObject({ id: "turn:c1" })
  })

  it("keys each item and lists its steps, for the page's fade-in", () => {
    const calls = [prompt("u", "Go"), call("c1", "Bash", "Run", 1), call("c2", "Bash", "Run", 2)]
    const [head, group, live] = storyOf([...calls, call("c3", "Bash", "Run", 3, "running")], open)
    expect([head!, group!, live!].map(storyKey)).toEqual(["u", "group:c1", "c3"])
    expect(storySteps(group!).map((s) => s.id)).toEqual(["c1", "c2"])
    const [, turn] = storyOf([...calls, said("m", "Done.", 3, true)], open)
    expect(storySteps(turn!).map((s) => s.id)).toEqual(["c1", "c2"])
  })

  it("a group that forms around a call the human had opened starts open, so that call stays open (CEL-170)", () => {
    const lone = [prompt("u", "Go"), call("c1", "Bash", "Run", 1)]
    // The lone call is a row of its own; with a second call it's inside a group with another id.
    expect(shape(storyOf(lone, open))).toEqual(["u", "c1"])
    const group = storyOf([...lone, call("c2", "Bash", "Run", 2)], open).find((item) => item._tag === "group")!
    const steps = storySteps(group)
    expect(groupStartsOpen(steps, new Set(["c1"]))).toBe(true)
    expect(groupStartsOpen(steps, new Set(["elsewhere"]))).toBe(false)
    expect(groupStartsOpen(steps, new Set())).toBe(false)
  })
})
