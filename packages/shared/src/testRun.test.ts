import { describe, expect, it } from "vitest"
import { elapsedWords, isRunning, isTestCommand, STALE_RUN_MS, testRunLabel, testRunShort, testRunWords, type TestRunLike } from "./testRun.ts"

describe("isTestCommand (CEL-134): does this shell command run tests?", () => {
  it.each([
    "bun run test",
    "bun run test -- apps/server/src/session",
    "bun run test:e2e -- e2e/agents-page.spec.ts",
    "CELLO_E2E_REVIEW=1 bun run test:docker:e2e -- e2e/agents-page.spec.ts",
    "bun run test:docker",
    "bun run test:docker:desktop -- e2e/x.spec.ts",
    "bun run test:e2e:local",
    "cd /Users/me/repo && bun run test 2>&1 | tail -20",
    "bun scripts/test-in-docker.ts e2e",
    "bun --bun vitest run apps/cli",
    "npx vitest run",
    "bunx playwright test e2e/board.spec.ts",
    "npm test",
    "npm run test:unit",
    "pnpm test",
    "yarn test",
    "bun test",
    "pytest -q",
    "cargo test",
    "go test ./...",
  ])("%s → yes", (command) => {
    expect(isTestCommand(command)).toBe(true)
  })

  it.each([
    "bun run typecheck",
    "bun run testing-profile",
    "ls test-results/docker/latest",
    "cat apps/cli/src/claudeHook.test.ts",
    "grep -rn 'bun run test' docs",
    "echo bun run test",
    "git commit -m 'bun run test passes'",
    "bun run docs:cli",
    "",
  ])("%s → no", (command) => {
    expect(isTestCommand(command)).toBe(false)
  })
})

describe("testRunLabel: what the run is called on the board", () => {
  it.each([
    ["bun run test:e2e -- e2e/agents-page.spec.ts", "web e2e"],
    ["CELLO_E2E_REVIEW=1 bun run test:docker:e2e -- e2e/x.spec.ts", "web e2e"],
    ["bun run test:e2e:local", "web e2e"],
    ["bun run test:docker:desktop", "desktop e2e"],
    ["bun run test:docker", "Docker tests"],
    ["bun scripts/test-in-docker.ts e2e", "web e2e"],
    ["bun scripts/test-in-docker.ts desktop", "desktop e2e"],
    ["bun scripts/test-in-docker.ts all", "Docker tests"],
    ["bun run test -- apps/server", "unit tests"],
    ["cd /repo && bun --bun vitest run", "unit tests"],
    ["bunx playwright test e2e/board.spec.ts", "e2e"],
    ["npm test", "tests"],
  ])("%s → %s", (command, label) => {
    expect(testRunLabel(command)).toBe(label)
  })
})

describe("the run in words", () => {
  const start = 1_000_000
  const run = (extra: Partial<TestRunLike> = {}): TestRunLike => ({ label: "web e2e", startedAt: start, endedAt: null, outcome: null, progress: null, ...extra })
  const progress = { stage: "web-e2e", passed: 6, failed: 1, skipped: 0, total: 13, current: "e2e/agents-page.spec.ts", failures: ["e2e/agents-page.spec.ts:40 › lists agents"], done: false, outcome: null, folder: null }

  it("elapsedWords: seconds, then minutes and seconds, then hours and minutes", () => {
    expect(elapsedWords(42_000)).toBe("42s")
    expect(elapsedWords(192_000)).toBe("3m12s")
    expect(elapsedWords(3_600_000 + 5 * 60_000)).toBe("1h05m")
    expect(elapsedWords(-5)).toBe("0s")
  })

  it("testRunWords: where a running one is, with its failures and time; how a finished one ended", () => {
    expect(testRunWords(run({ progress }), start + 192_000)).toBe("web e2e 7 of 13 · 1 failed · 3m12s")
    expect(testRunWords(run({ progress }), start + 192_000, { failed: false })).toBe("web e2e 7 of 13 · 3m12s")
    expect(testRunWords(run({ progress: { ...progress, failed: 0, total: null } }), start + 5_000)).toBe("web e2e 6 done · 5s")
    expect(testRunWords(run(), start + 80_000)).toBe("web e2e · 1m20s")
    expect(testRunWords(run({ endedAt: start + 242_000, outcome: "passed", progress: { ...progress, passed: 13, failed: 0 } }), start + 999_999))
      .toBe("web e2e passed · 13 of 13 · 4m02s")
    expect(testRunWords(run({ endedAt: start + 60_000, outcome: "failed", progress: { ...progress, passed: 12 } }), start)).toBe("web e2e failed · 1 failed of 13 · 1m00s")
    expect(testRunWords(run({ endedAt: start + 60_000, outcome: "ended" }), start)).toBe("web e2e ended · 1m00s")
  })

  it("isRunning: not ended, and not started so long ago its end was surely missed", () => {
    expect(isRunning(run(), start + 1000)).toBe(true)
    expect(isRunning(run({ endedAt: start + 10, outcome: "passed" }), start + 1000)).toBe(false)
    expect(isRunning(run(), start + STALE_RUN_MS)).toBe(false)
    expect(isRunning(null, start)).toBe(false)
  })

  it("testRunShort: the card's stage line, \"e2e 7/13\"", () => {
    expect(testRunShort(run({ progress }))).toBe("web e2e 7/13")
    expect(testRunShort(run({ progress: { ...progress, total: null } }))).toBe("web e2e 7 done")
    expect(testRunShort(run())).toBe("web e2e")
  })
})
