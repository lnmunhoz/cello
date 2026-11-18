import { describe, expect, it } from "vitest"
import {
  commandWords,
  DOCKER_LABELS,
  DOCKER_STEPS,
  elapsedWords,
  isRunning,
  isTestCommand,
  STALE_RUN_MS,
  stageFits,
  testRunLabel,
  testRunShort,
  testRunKey,
  testRunTargets,
  testRunWords,
  type TestRunLike,
} from "./testRun.ts"

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
    'git commit -m "fix it; bun run test passes"',
    "echo 'a && bun run test:e2e'",
    "bun run docs:cli",
    "",
  ])("%s → no", (command) => {
    expect(isTestCommand(command)).toBe(false)
  })
})

describe("commandWords", () => {
  it("splits at separators and spaces, not inside quotes; a redirection stays a word", () => {
    expect(commandWords(`cd /repo && git commit -m "fix; bun run test" | tee out 2>&1; ls 'a b'`)).toEqual([
      ["cd", "/repo"],
      ["git", "commit", "-m", "fix; bun run test"],
      ["tee", "out", "2>&1"],
      ["ls", "a b"],
    ])
    expect(commandWords("")).toEqual([])
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

// CEL-147: two Docker runs from one folder are told apart by the stage their runner reports.
describe("stageFits: could a runner reporting this stage be this run?", () => {
  it("names each Docker mode's run as testRunLabel does", () => {
    for (const mode of ["all", "e2e", "desktop"] as const) expect(testRunLabel(`bun scripts/test-in-docker.ts ${mode}`)).toBe(DOCKER_LABELS[mode])
  })

  it.each([
    ["web-e2e", "web e2e", true],
    ["web-e2e", "Docker tests", true],
    ["web-e2e", "desktop e2e", false],
    ["desktop-e2e", "desktop e2e", true],
    ["desktop-e2e", "web e2e", false],
    ["unit", "Docker tests", true],
    ["unit", "web e2e", false],
    ["typecheck", "desktop e2e", false],
    // Every Docker run installs first, so installing fits them all, and nothing else.
    ["install", "web e2e", true],
    ["install", "desktop e2e", true],
    ["install", "Docker tests", true],
    ["install", "unit tests", false],
    // A runner that names no stage, or one Cello doesn't know, fits no run in particular.
    [null, "web e2e", false],
    ["build", "tests", false],
  ] as const)("%s, %s → %s", (stage, label, fits) => {
    expect(stageFits(stage, label)).toBe(fits)
  })

  it("is what each mode runs, in order", () => {
    expect(DOCKER_STEPS).toEqual({
      all: ["install", "unit", "typecheck", "web-e2e", "desktop-e2e"],
      e2e: ["install", "web-e2e"],
      desktop: ["install", "desktop-e2e"],
    })
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

  it("testRunTargets (CEL-181): the files and folders a test command named, not flags or VAR=x", () => {
    expect(testRunTargets("bun run test:e2e -- e2e/pages.spec.ts")).toEqual(["e2e/pages.spec.ts"])
    expect(testRunTargets("CELLO_E2E_REVIEW=1 bun run test:docker:e2e -- e2e/a.spec.ts e2e/b.spec.ts")).toEqual(["e2e/a.spec.ts", "e2e/b.spec.ts"])
    expect(testRunTargets("bun run test -- apps/server")).toEqual(["apps/server"])
    expect(testRunTargets("bun run test")).toEqual([])
    expect(testRunTargets("bun run test -- --reporter=dot apps/server -t \"a name\"")).toEqual(["apps/server"])
    expect(testRunTargets("bun run test -- apps/server && bun run typecheck apps/web")).toEqual(["apps/server"])
    expect(testRunTargets("cd apps/web && bun run test -- src/a.test.ts")).toEqual(["src/a.test.ts"])
    expect(testRunTargets("echo hi")).toEqual([])
  })

  it("testRunTargets: the value after a flag that takes one is not a target", () => {
    expect(testRunTargets("bun run test -- -t foo.bar apps/server")).toEqual(["apps/server"])
    expect(testRunTargets("bun run test -- --grep foo.bar")).toEqual([])
    expect(testRunTargets("bun run test:e2e -- -g x/y e2e/a.spec.ts")).toEqual(["e2e/a.spec.ts"])
    expect(testRunTargets("bun run test -- --testNamePattern a.b")).toEqual([])
    expect(testRunTargets("bunx playwright test --project web e2e/a.spec.ts --reporter ./r.ts")).toEqual(["e2e/a.spec.ts"])
    expect(testRunTargets("bunx vitest run -c ./vitest.config.ts src/a.test.ts")).toEqual(["src/a.test.ts"])
    expect(testRunTargets("bunx vitest run --config ./vitest.config.ts src/a.test.ts")).toEqual(["src/a.test.ts"])
    // `--x=y` carries its value; a flag that takes none leaves the next word alone.
    expect(testRunTargets("bun run test -- --reporter=./r.ts --run apps/web/src/a.test.ts")).toEqual(["apps/web/src/a.test.ts"])
  })

  it("testRunWords with targets: up to two after the label, \"+N more\" for the rest, running and finished", () => {
    const named = (command: string, extra: Partial<TestRunLike> = {}) => run({ command, ...extra })
    const one = "bun run test:e2e -- e2e/pages.spec.ts"
    expect(testRunWords(named(one, { progress }), start + 192_000, { targets: true })).toBe("web e2e · e2e/pages.spec.ts · 7 of 13 · 1 failed · 3m12s")
    expect(testRunWords(named(one, { endedAt: start + 104_000, outcome: "passed", progress: { ...progress, passed: 3, failed: 0, total: 3 } }), start, { targets: true }))
      .toBe("web e2e passed · e2e/pages.spec.ts · 3 of 3 · 1m44s")
    expect(testRunWords(named("bun run test:e2e -- e2e/a.spec.ts e2e/b.spec.ts e2e/c.spec.ts e2e/d.spec.ts"), start + 5_000, { targets: true })).toBe("web e2e · e2e/a.spec.ts, e2e/b.spec.ts +2 more · 5s")
    // No command, or no targets in it: the same words as without the option.
    expect(testRunWords(run(), start + 80_000, { targets: true })).toBe("web e2e · 1m20s")
    expect(testRunWords(named("bun run test:e2e"), start + 80_000, { targets: true })).toBe("web e2e · 1m20s")
    // Without the option the Agents page and the card read as before.
    expect(testRunWords(named(one, { progress }), start + 192_000)).toBe("web e2e 7 of 13 · 1 failed · 3m12s")
  })

  it("testRunKey: one id for a run, in its live row and in its finished line", () => {
    expect(testRunKey("S1", "A9", 1_700_000)).toBe("tests:S1:A9:1700000")
    expect(testRunKey("S1", null, 1_700_000)).toBe("tests:S1:-:1700000")
  })

  it("testRunShort: the card's stage line, \"e2e 7/13\"", () => {
    expect(testRunShort(run({ progress }))).toBe("web e2e 7/13")
    expect(testRunShort(run({ progress: { ...progress, total: null } }))).toBe("web e2e 7 done")
    expect(testRunShort(run())).toBe("web e2e")
  })
})
