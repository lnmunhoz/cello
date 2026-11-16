// What an agent is doing besides its last tool call (CEL-133): the background work it started, and
// whether a stop finishes it or leaves it waiting on that work.
import { describe, expect, it } from "vitest"
import {
  type BackgroundWork,
  MAX_BACKGROUND,
  parseBackground,
  parseTests,
  parseWaiting,
  publicRun,
  sameFolder,
  stopOutcome,
  testsBackgrounded,
  testsProgressed,
  testsStarted,
  testsToolFinished,
  testsTurnEnded,
  withBackground,
} from "./activity.ts"

const e2e = { id: "blo3xolgq", label: "Bash · bun run test:e2e -- e2e/agents-page.spec.ts", toolUseId: "toolu_1" }
const monitor = { id: "bpz2edzeb", label: "Monitor · review-mode e2e run finishing", toolUseId: "toolu_2" }

describe("withBackground", () => {
  it("adds background work once, by its id, newest last, keeping the latest MAX_BACKGROUND", () => {
    expect(withBackground([e2e], monitor)).toEqual([e2e, monitor])
    expect(withBackground([e2e, monitor], { ...e2e, label: "again" })).toEqual([monitor, { ...e2e, label: "again" }])
    const many = Array.from({ length: MAX_BACKGROUND + 3 }, (_, i) => ({ id: `b${i}`, label: `Bash · ${i}`, toolUseId: null }))
    const kept = many.reduce<ReadonlyArray<BackgroundWork>>((list, work) => withBackground(list, work), [])
    expect(kept).toHaveLength(MAX_BACKGROUND)
    expect(kept.at(-1)?.id).toBe(`b${MAX_BACKGROUND + 2}`)
  })
})

describe("stopOutcome: does a stop finish the agent?", () => {
  it("leaves it waiting while work it started itself is still running, naming that work", () => {
    expect(stopOutcome([e2e, monitor], ["bpz2edzeb", "other-agents-shell"])).toEqual({
      finished: false,
      background: [monitor],
      waitingOn: ["Monitor · review-mode e2e run finishing"],
    })
  })

  it("finishes it when none of its own work is still running, whatever else the session runs", () => {
    expect(stopOutcome([e2e], ["the-parents-inbox-wait"])).toEqual({ finished: true, background: [], waitingOn: null })
    expect(stopOutcome([], [])).toEqual({ finished: true, background: [], waitingOn: null })
  })

  it("finishes it when Claude Code didn't say what runs (an older version): as before", () => {
    expect(stopOutcome([e2e], undefined)).toEqual({ finished: true, background: [], waitingOn: null })
  })
})

// CEL-134: a run starts when a tool call runs a test command, takes the runner's progress, and ends with
// the call (foreground), the runner's last report, or the turn that leaves it behind.
describe("a test run", () => {
  const started = testsStarted({ runId: "toolu_1", command: "bun run test:e2e -- e2e/agents-page.spec.ts", cwd: "/repo/wt", now: 1000 })
  const progress = { stage: "web-e2e", passed: 6, failed: 1, skipped: 0, total: 13, current: "e2e/agents-page.spec.ts", failures: ["e2e/agents-page.spec.ts:40 › lists"], done: false, outcome: null, folder: null }

  it("starts from the call: named for the board, in the foreground, no progress yet", () => {
    expect(started).toEqual({
      runId: "toolu_1", cwd: "/repo/wt", label: "web e2e", command: "bun run test:e2e -- e2e/agents-page.spec.ts",
      startedAt: 1000, endedAt: null, outcome: null, background: false, progress: null,
    })
    expect(publicRun(started)).not.toHaveProperty("runId")
    expect(publicRun(started)).not.toHaveProperty("cwd")
  })

  it("a foreground run ends with its own call: passed, or failed when the call failed; another call's end changes nothing", () => {
    expect(testsToolFinished(started, "toolu_2", false, 5000)).toBe(started)
    expect(testsToolFinished(started, "toolu_1", false, 5000)).toMatchObject({ endedAt: 5000, outcome: "passed" })
    expect(testsToolFinished(started, "toolu_1", true, 5000)).toMatchObject({ endedAt: 5000, outcome: "failed" })
  })

  it("run in the background, it takes the task's id and outlives its call, until the turn that leaves it behind no longer runs it", () => {
    const background = testsBackgrounded(started, "toolu_1", "blo3xolgq")
    expect(background).toMatchObject({ runId: "blo3xolgq", background: true, endedAt: null })
    expect(testsBackgrounded(started, "toolu_9", "b9")).toBe(started)
    expect(testsToolFinished(background, "toolu_1", false, 5000)).toBe(background)
    expect(testsTurnEnded(background, ["blo3xolgq"], 6000)).toBe(background)
    expect(testsTurnEnded(background, [], 6000)).toMatchObject({ endedAt: 6000, outcome: "ended" })
    // Not knowing what runs, a background run is left running; a foreground one is over with the turn.
    expect(testsTurnEnded(background, undefined, 6000)).toBe(background)
    expect(testsTurnEnded(started, undefined, 6000)).toMatchObject({ endedAt: 6000, outcome: "ended" })
  })

  it("takes the runner's progress while it runs; the runner's last report ends it with its outcome; an ended run takes no more", () => {
    const running = testsProgressed(started, progress, 3000)
    expect(running).toMatchObject({ progress, endedAt: null })
    const done = testsProgressed(running, { ...progress, passed: 12, done: true, outcome: "failed", folder: "/repo/wt/test-results/docker/x" }, 9000)
    expect(done).toMatchObject({ endedAt: 9000, outcome: "failed", progress: { folder: "/repo/wt/test-results/docker/x" } })
    expect(testsProgressed(done, progress, 9500)).toBe(done)
    expect(testsProgressed(started, { ...progress, done: true, outcome: "stopped" }, 4000)).toMatchObject({ outcome: "ended" })
    // A turn ending after the runner's last report keeps its outcome; its turn's end keeps a passed foreground run passed.
    expect(testsTurnEnded(done, [], 9900)).toBe(done)
  })

  it("parseTests reads the stored run, and anything it can't read as none", () => {
    expect(parseTests(JSON.stringify(started))).toEqual(started)
    expect(parseTests(null)).toBeNull()
    expect(parseTests("[]")).toBeNull()
    expect(parseTests(JSON.stringify({ label: "x" }))).toBeNull()
  })

  it("sameFolder: the runner's folder and the call's, one inside the other", () => {
    expect(sameFolder("/repo/wt", "/repo/wt")).toBe(true)
    expect(sameFolder("/repo/wt/apps/web", "/repo/wt")).toBe(true)
    expect(sameFolder("/repo/wt", "/repo/wt/apps/web")).toBe(true)
    expect(sameFolder("/repo/wt2", "/repo/wt")).toBe(false)
    expect(sameFolder(null, "/repo/wt")).toBe(false)
  })
})

describe("parseBackground and parseWaiting", () => {
  it("read the stored lists, and anything they can't read as none", () => {
    expect(parseBackground(JSON.stringify([e2e, monitor]))).toEqual([e2e, monitor])
    expect(parseBackground(null)).toEqual([])
    expect(parseBackground("not json")).toEqual([])
    expect(parseBackground(JSON.stringify([{ id: 3 }, e2e, "x"]))).toEqual([e2e])
    expect(parseWaiting(JSON.stringify(["Bash · x"]))).toEqual(["Bash · x"])
    expect(parseWaiting(JSON.stringify([]))).toBeNull()
    expect(parseWaiting("{")).toBeNull()
  })
})
