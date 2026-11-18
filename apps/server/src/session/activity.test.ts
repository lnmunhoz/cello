// What an agent is doing besides its last tool call (CEL-133): the background work it started, and
// whether a stop finishes it or leaves it waiting on that work.
import type { TestProgress } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import {
  type BackgroundWork,
  MAX_BACKGROUND,
  parseBackground,
  endedNow,
  MAX_RUNS,
  parseRuns,
  runsOf,
  pickRun,
  shownRun,
  type StoredTestRun,
  withRun,
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

/** A runner's report: where it is, which stage, its run folder. */
const report = (extra: Partial<TestProgress> = {}): TestProgress => ({
  stage: "web-e2e", passed: 0, failed: 0, skipped: 0, total: null, current: null, failures: [], done: false, outcome: null, folder: null, ...extra,
})

const e2e = { id: "blo3xolgq", label: "Bash · bun run test:e2e -- e2e/agents-page.spec.ts", toolUseId: "toolu_1", waits: true }
const monitor = { id: "bpz2edzeb", label: "Monitor · review-mode e2e run finishing", toolUseId: "toolu_2", waits: true }

describe("withBackground", () => {
  it("adds background work once, by its id, newest last, keeping the latest MAX_BACKGROUND", () => {
    expect(withBackground([e2e], monitor)).toEqual([e2e, monitor])
    expect(withBackground([e2e, monitor], { ...e2e, label: "again" })).toEqual([monitor, { ...e2e, label: "again" }])
    const many = Array.from({ length: MAX_BACKGROUND + 3 }, (_, i) => ({ id: `b${i}`, label: `Bash · ${i}`, toolUseId: null, waits: true }))
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

  it("only work it waits for keeps it waiting (a Monitor, a test run): a dev server it left running in the background doesn't", () => {
    const dev = { id: "bdev0001", label: "Bash · bun run dev", toolUseId: "toolu_3", waits: false }
    expect(stopOutcome([dev], ["bdev0001"])).toEqual({ finished: true, background: [], waitingOn: null })
    expect(stopOutcome([dev, e2e], ["bdev0001", "blo3xolgq"])).toEqual({ finished: false, background: [e2e], waitingOn: [e2e.label] })
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

  it("parseRuns reads the stored runs, and drops any that isn't one whole run, so a bad row can't break what boards are sent", () => {
    expect(parseRuns(JSON.stringify([started]))).toEqual([started])
    expect(parseRuns(null)).toEqual([])
    expect(parseRuns("{")).toEqual([])
    expect(parseRuns(JSON.stringify({ label: "x" }))).toEqual([])
    // A run missing endedAt, or with a progress whose stage is a number: dropped, the good one kept.
    const { endedAt: _endedAt, ...noEnd } = started
    const badProgress = { ...started, runId: "t9", progress: { ...progress, stage: 42 } }
    expect(parseRuns(JSON.stringify([noEnd, badProgress, started]))).toEqual([started])
  })

  it("CEL-181: a run keeps its task; a run stored before it (no key) still parses, and the task reaches boards", () => {
    const tasked = testsStarted({ runId: "toolu_9", command: "bun run test", cwd: "/repo", now: 1000, taskId: "t1" })
    expect(tasked.taskId).toBe("t1")
    expect(parseRuns(JSON.stringify([tasked]))[0]?.taskId).toBe("t1")
    // An old row, written before the key existed, is kept whole (a required key would drop every run in flight).
    const old = JSON.parse(JSON.stringify(started)) as Record<string, unknown>
    expect("taskId" in old).toBe(false)
    expect(parseRuns(JSON.stringify([old]))).toHaveLength(1)
    // Boards need the task for the live row, but never the run's id or folder.
    expect(publicRun(tasked)).toMatchObject({ taskId: "t1" })
    expect(publicRun(tasked)).not.toHaveProperty("runId")
    expect(publicRun(tasked)).not.toHaveProperty("cwd")
    expect(runsOf(JSON.stringify([started, tasked]))).toEqual([publicRun(started), publicRun(tasked)])
    expect(runsOf(null)).toEqual([])
  })

  it("CEL-181 endedNow: the runs a change ended, matched by run id, once", () => {
    const a = testsStarted({ runId: "a", command: "bun run test", cwd: null, now: 1000, taskId: "t1" })
    const b = testsBackgrounded(testsStarted({ runId: "b", command: "bun run test:docker:e2e", cwd: null, now: 1100 }), "b", "bg1")
    const before = [a, b]
    expect(endedNow(before, before)).toEqual([])
    const aEnded = testsToolFinished(a, "a", false, 2000)
    expect(endedNow(before, [aEnded, b])).toEqual([aEnded])
    // Already ended before: a late report or a second stop ends nothing more.
    expect(endedNow([aEnded, b], [aEnded, b])).toEqual([])
    expect(endedNow([aEnded, b], [testsProgressed(aEnded, report({ done: true, outcome: "failed" }), 3000), b])).toEqual([])
    // A run `withRun` dropped from the list isn't ended.
    expect(endedNow(before, [b])).toEqual([])
    // Both end together.
    const bEnded = testsTurnEnded(b, [], 2500)
    expect(endedNow(before, [aEnded, bEnded]).map((r) => r.runId)).toEqual(["a", "bg1"])
    // A run that took a background id in the same change but didn't end isn't ended.
    expect(endedNow([a], [testsBackgrounded(a, "a", "bg9")])).toEqual([])
  })

  it("sameFolder: the runner's folder and the call's, one inside the other", () => {
    expect(sameFolder("/repo/wt", "/repo/wt")).toBe(true)
    expect(sameFolder("/repo/wt/apps/web", "/repo/wt")).toBe(true)
    expect(sameFolder("/repo/wt", "/repo/wt/apps/web")).toBe(true)
    expect(sameFolder("/repo/wt2", "/repo/wt")).toBe(false)
    expect(sameFolder(null, "/repo/wt")).toBe(false)
  })
})

// Review S2: an agent can run a foreground test command while its background Docker run goes on.
describe("an agent's runs", () => {
  const docker = testsBackgrounded(testsStarted({ runId: "toolu_d", command: "bun run test:docker:e2e", cwd: "/repo/wt", now: 1000 }), "toolu_d", "blo3xolgq")
  const unit = testsStarted({ runId: "toolu_u", command: "bun run test -- apps/web", cwd: "/repo/wt", now: 2000 })
  const progress = { stage: "web-e2e", passed: 13, failed: 0, skipped: 0, total: 13, current: null, failures: [], done: false, outcome: null, folder: null }

  it("a new run never replaces a live one: both are kept, ended ones go, at most MAX_RUNS", () => {
    expect(withRun([docker], unit)).toEqual([docker, unit])
    const ended = testsToolFinished(unit, "toolu_u", false, 3000)
    const next = testsStarted({ runId: "toolu_v", command: "bun run test", cwd: "/repo/wt", now: 4000 })
    expect(withRun([docker, ended], next)).toEqual([docker, next])
    const many = Array.from({ length: MAX_RUNS + 2 }, (_, i) => testsStarted({ runId: `t${i}`, command: "bun run test", cwd: null, now: i }))
    expect(many.reduce<ReadonlyArray<StoredTestRun>>(withRun, [])).toHaveLength(MAX_RUNS)
  })

  // CEL-147 review: an ended run that took a run folder's reports is remembered, so that folder's late reports stay with it.
  it("a new run keeps the ended runs bound to a run folder, in the room live runs leave, newest first", () => {
    const bound = (runId: string, now: number) =>
      testsTurnEnded(testsProgressed(testsStarted({ runId, command: "bun run test:docker:e2e", cwd: "/repo/wt", now }), { ...progress, folder: `/repo/wt/r-${runId}` }, now), [], now + 1)
    const [a, b, c] = [bound("a", 1), bound("b", 2), bound("c", 3)]
    expect(withRun([a, unit], docker)).toEqual([a, unit, docker])
    // Live runs come first; the newest bound ones fill what's left of MAX_RUNS.
    expect(withRun([a, b, c, unit], docker)).toEqual([b, c, unit, docker])
    const live = Array.from({ length: MAX_RUNS - 1 }, (_, i) => testsStarted({ runId: `l${i}`, command: "bun run test", cwd: null, now: 10 + i }))
    expect(withRun([a, ...live], docker)).toEqual([...live, docker])
  })

  it("shownRun: the newest running one, else the one that ended last", () => {
    const ended = testsToolFinished(unit, "toolu_u", true, 3000)
    expect(shownRun([docker, unit])).toBe(unit)
    expect(shownRun([docker, ended])).toBe(docker)
    const dockerDone = testsProgressed(docker, { ...progress, done: true, outcome: "passed" }, 9000)
    expect(shownRun([dockerDone, ended])).toBe(dockerDone)
    expect(shownRun([])).toBeNull()
  })

  // Review S1: the orchestrator runs tests at the repo root while a builder runs its own in a worktree inside it.
  it("pickRun: the run started from the runner's folder exactly, else the deepest folder holding it or inside it", () => {
    const root = { ...testsStarted({ runId: "r", command: "bun run test", cwd: "/repo", now: 5000 }), who: "orchestrator" }
    const builder = { ...testsStarted({ runId: "b", command: "bun run test:e2e", cwd: "/repo/.claude/worktrees/agent-a13b", now: 1000 }), who: "builder" }
    const candidates = [{ run: root }, { run: builder }]
    expect(pickRun(candidates, "/repo/.claude/worktrees/agent-a13b", report())?.run.who).toBe("builder")
    expect(pickRun(candidates, "/repo/.claude/worktrees/agent-a13b/apps/web", report())?.run.who).toBe("builder")
    expect(pickRun(candidates, "/repo", report())?.run.who).toBe("orchestrator")
    expect(pickRun(candidates, "/repo/apps/web", report())?.run.who).toBe("orchestrator")
    // No folder matches: the session's only running run, else none.
    expect(pickRun([{ run: builder }], "/elsewhere", report())?.run.who).toBe("builder")
    expect(pickRun(candidates, "/elsewhere", report())).toBeUndefined()
  })
})

// CEL-147: two runs started from one folder tied on it, so every report went to the newest and they swapped.
describe("pickRun: two runs from one folder", () => {
  const wt = "/repo/wt"
  const desktopFolder = `${wt}/test-results/docker/2026-11-17_125519-desktop-1`
  const webFolder = `${wt}/test-results/docker/2026-11-17_125522-e2e-2`
  const desktop = { run: testsStarted({ runId: "d", command: "bun run test:docker:desktop", cwd: wt, now: 1000 }), who: "desktop" }
  const web = { run: testsStarted({ runId: "w", command: "bun run test:docker:e2e", cwd: wt, now: 4000 }), who: "web" }
  /** The candidate after its run took `progress`. */
  const took = <C extends { readonly run: StoredTestRun }>(c: C, progress: TestProgress): C => ({ ...c, run: testsProgressed(c.run, progress, 9000) })

  it("goes by the stage the runner is on: each Docker run's own stage fits only it", () => {
    expect(pickRun([desktop, web], wt, report({ stage: "web-e2e", folder: webFolder }))?.who).toBe("web")
    expect(pickRun([desktop, web], wt, report({ stage: "desktop-e2e", folder: desktopFolder }))?.who).toBe("desktop")
    // A unit run (no reporter of its own) never takes a Docker runner's report while a Docker run is there.
    const unit = { run: testsStarted({ runId: "u", command: "bun run test", cwd: wt, now: 500 }), who: "unit" }
    expect(pickRun([unit, web], wt, report({ stage: "install", folder: webFolder }))?.who).toBe("web")
  })

  it("while the stage fits both (installing), waits for one that tells them apart; the last report goes to the oldest", () => {
    expect(pickRun([desktop, web], wt, report({ stage: "install", folder: webFolder }))).toBeUndefined()
    expect(pickRun([desktop, web], wt, report({ stage: "install", folder: webFolder, done: true, outcome: "failed" }))?.who).toBe("desktop")
  })

  it("runs nothing tells apart (the same command twice, a runner that names no stage) go oldest first", () => {
    const again = { run: testsStarted({ runId: "w2", command: "bun run test:docker:e2e", cwd: wt, now: 6000 }), who: "web again" }
    expect(pickRun([again, web], wt, report({ stage: "install", folder: webFolder }))?.who).toBe("web")
    expect(pickRun([again, web], wt, report({ stage: "web-e2e", folder: webFolder }))?.who).toBe("web")
    expect(pickRun([desktop, web], wt, report({ stage: null, folder: null }))?.who).toBe("desktop")
  })

  it("a run takes only reports from the run folder it first took one from, and that folder's reports go only to it", () => {
    const bound = took(desktop, report({ stage: "desktop-e2e", folder: desktopFolder }))
    // Installing, the web runner's report now has one run left that it could be.
    expect(pickRun([bound, web], wt, report({ stage: "install", folder: webFolder }))?.who).toBe("web")
    // Its folder's reports stay with it, even from another folder or with a stage that fits the other run.
    expect(pickRun([bound, web], "/elsewhere", report({ stage: "desktop-e2e", folder: desktopFolder }))?.who).toBe("desktop")
    expect(pickRun([bound, web], wt, report({ stage: "web-e2e", folder: desktopFolder }))?.who).toBe("desktop")
    // A report without a folder, or from another one, never goes to it.
    expect(pickRun([bound, web], wt, report({ stage: "desktop-e2e", folder: null }))?.who).toBe("web")
    expect(pickRun([bound], wt, report({ stage: "desktop-e2e", folder: webFolder }))).toBeUndefined()
    expect(pickRun([bound], "/elsewhere", report({ folder: null }))).toBeUndefined()
  })

  it("an ended run keeps its folder's reports: they never reopen it or go to another run", () => {
    const ended = took(desktop, report({ stage: "desktop-e2e", folder: desktopFolder, done: true, outcome: "passed" }))
    expect(ended.run.endedAt).toBe(9000)
    expect(pickRun([ended, web], wt, report({ stage: "desktop-e2e", folder: desktopFolder }))?.who).toBe("desktop")
    // An ended run that never took a report takes none: it's nobody's to bind any more.
    const turnEnded = { ...desktop, run: testsTurnEnded(desktop.run, [], 9000) }
    expect(pickRun([turnEnded], wt, report({ stage: "desktop-e2e", folder: desktopFolder }))).toBeUndefined()
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
