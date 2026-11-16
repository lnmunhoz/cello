// The Docker runner's progress.json (CEL-134): read from the container's output as it streams, so the
// board shows "web e2e 7 of 13 · 1 failed" while the run goes, and each failure as it happens.
import { describe, expect, it } from "vitest"
import { feed, finish, lineSplitter, MAX_LINE, PROGRESS_FILE, startProgress } from "./progress.ts"

const lines = (state: ReturnType<typeof startProgress>, text: string) => text.split("\n").reduce(feed, state)

describe("progress from the container's output", () => {
  const start = startProgress("/repo/test-results/docker/2026-11-17_020000-e2e-1")

  it("starts empty, with its folder, not done", () => {
    expect(start).toEqual({
      stage: null, passed: 0, failed: 0, skipped: 0, total: null, current: null, failures: [], done: false, outcome: null,
      folder: "/repo/test-results/docker/2026-11-17_020000-e2e-1",
    })
    expect(PROGRESS_FILE).toBe("progress.json")
  })

  it("follows a Playwright run line by line: the stage, the total, each test as it ends, failures by spec and title", () => {
    // As logs/web-e2e.log has it (a real run, 2026-11-15), the build's own ✓ lines included.
    const state = lines(start, [
      "== install",
      "bun install v1.4.4",
      "== web-e2e",
      "$ bun run --filter @cello/web build && playwright test \"e2e/display.spec.ts\"",
      "@cello/web build: ✓ 4993 modules transformed.",
      "Running 12 tests using 1 worker",
      "",
      "  ✓   1 e2e/display.spec.ts:53:1 › ordering: Display sorts each column by newest (4.5s)",
      "  ✘   2 e2e/display.spec.ts:119:1 › ordering: under a sorted order a drag changes the status only (7.5s)",
      "  ✓   3 [chromium] › e2e/agents-page.spec.ts:20:1 › agents page: lists the agents (578ms)",
      "  -   4 e2e/display.spec.ts:173:1 › skipped one",
    ].join("\n"))
    expect(state).toMatchObject({
      stage: "web-e2e", total: 12, passed: 2, failed: 1, skipped: 1, current: "e2e/display.spec.ts",
      failures: ["e2e/display.spec.ts:119 › ordering: under a sorted order a drag changes the status only"],
    })
  })

  it("a new stage starts its own counts and keeps the failures so far", () => {
    const state = lines(start, [
      "== web-e2e",
      "Running 2 tests using 1 worker",
      "  ✘   1 e2e/a.spec.ts:1:1 › a (1s)",
      "== desktop-e2e",
      "Running 3 tests using 1 worker",
      "  ✓   1 e2e/b.spec.ts:1:1 › b (1s)",
    ].join("\n"))
    expect(state).toMatchObject({ stage: "desktop-e2e", total: 3, passed: 1, failed: 0, failures: ["e2e/a.spec.ts:1 › a"] })
  })

  it("follows Vitest's per-file lines too: passed and failed tests, the failing file", () => {
    const state = lines(start, [
      "== unit",
      " ✓ apps/server/src/session/activity.test.ts (11 tests) 12ms",
      " ❯ apps/cli/src/claudeHook.test.ts (63 tests | 2 failed) 40ms",
      "   × waits for the run",
    ].join("\n"))
    expect(state).toMatchObject({ stage: "unit", passed: 72, failed: 2, total: null, current: "apps/cli/src/claudeHook.test.ts", failures: ["apps/cli/src/claudeHook.test.ts"] })
  })

  it("reads only the first MAX_LINE characters of a line: an absurdly long one is cut, not read whole", () => {
    const long = `  ✘   1 e2e/a.spec.ts:1:1 › ${"x".repeat(1_000_000)}`
    const state = lines(start, `== web-e2e\n${long}`)
    // Cut, its time suffix never seen: the title is what fits.
    expect(state.failed).toBe(1)
    expect(state.failures[0]!.length).toBeLessThan(MAX_LINE)
  })

  it("keeps the newest 20 failures", () => {
    const many = Array.from({ length: 25 }, (_, i) => `  ✘   ${i + 1} e2e/x.spec.ts:${i + 1}:1 › test ${i + 1} (1s)`).join("\n")
    const state = lines(start, `== web-e2e\n${many}`)
    expect(state.failed).toBe(25)
    expect(state.failures).toHaveLength(20)
    expect(state.failures.at(-1)).toBe("e2e/x.spec.ts:25 › test 25")
  })

  it("lineSplitter: whole lines from chunks that end anywhere", () => {
    const split = lineSplitter()
    expect(split.push("== web-e2e\nRunning 3 te")).toEqual(["== web-e2e"])
    expect(split.push("sts using 1 worker\r\n  ✓   1 e2e/a")).toEqual(["Running 3 tests using 1 worker"])
    expect(split.end()).toEqual(["  ✓   1 e2e/a"])
  })

  it("finish: done, passed on exit 0, failed otherwise, stopped when it was stopped", () => {
    expect(finish(start, { exit: 0, signalled: false })).toMatchObject({ done: true, outcome: "passed" })
    expect(finish(start, { exit: 1, signalled: false })).toMatchObject({ done: true, outcome: "failed" })
    expect(finish(start, { exit: null, signalled: true })).toMatchObject({ done: true, outcome: "stopped" })
  })
})
