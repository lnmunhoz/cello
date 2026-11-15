import { describe, expect, it } from "vitest"
import { countsFrom, duration, parseSteps, summarize } from "./summary.ts"

const vitestLog = `
 RUN  v5.1.0 /work

 Test Files  71 passed (71)
      Tests  392 passed (392)
   Start at  11:45:34
   Duration  7.38s (tests 50%, import 25%, transform 23%, worker 1%)
`

const playwrightLog = `
Running 5 tests using 1 worker

  ✓  1 desktop.spec.ts:44:1 › joins a running server (12.1s)
  ✘  2 desktop.spec.ts:120:1 › CEL-12: evidence (30.0s)
  -  5 desktop.spec.ts:222:1 › shows a claude.ai artifact page

  1) desktop.spec.ts:120:1 › CEL-12: evidence

    Error: expect(locator).toBeVisible() failed

  1 failed
    desktop.spec.ts:120:1 › CEL-12: evidence
  1 skipped
  3 passed (1.4m)
`

describe("parseSteps", () => {
  it("reads the steps the container recorded: name, exit code, seconds", () => {
    expect(parseSteps("install\t0\t21\nunit\t1\t64\n\n")).toEqual([
      { name: "install", code: 0, seconds: 21 },
      { name: "unit", code: 1, seconds: 64 },
    ])
  })
})

describe("countsFrom", () => {
  it("picks Vitest's totals", () => {
    expect(countsFrom(vitestLog)).toBe("71 files, 392 passed")
  })

  it("picks Playwright's totals, failures first", () => {
    expect(countsFrom(playwrightLog)).toBe("1 failed, 1 skipped, 3 passed")
  })

  it("ignores colours, and says nothing for a log without totals (typecheck)", () => {
    expect(countsFrom("\u001b[32m  4 passed\u001b[39m (20s)\n")).toBe("4 passed")
    expect(countsFrom("$ tsc -p .\n")).toBe("")
  })
})

describe("duration", () => {
  it("reads as minutes and seconds", () => {
    expect(duration(7)).toBe("7s")
    expect(duration(64)).toBe("1m 04s")
    expect(duration(3725)).toBe("62m 05s")
  })
})

describe("summarize", () => {
  const base = {
    mode: "all" as const,
    args: [],
    started: new Date(2026, 10, 15, 9, 5, 0),
    seconds: 412,
    image: "cello-test:pw1.65.1-bun1.4.4-0123456789",
    repo: "/Users/x/cello/.claude/worktrees/agent-1",
    commit: "583cf28 with uncommitted changes",
    limits: "4 CPUs, 6g memory",
    env: { CELLO_E2E_SLOWMO: "400" },
    files: { "web/videos": 3, "desktop/videos": 4, "desktop/screenshots": 3 },
  }

  it("lists each step with its result, time and totals, then the overall result and where the files are", () => {
    const text = summarize({
      ...base,
      steps: [
        { name: "install", code: 0, seconds: 21 },
        { name: "unit", code: 0, seconds: 64 },
        { name: "desktop-e2e", code: 1, seconds: 90 },
      ],
      logs: { unit: vitestLog, "desktop-e2e": playwrightLog },
    })
    expect(text).toContain("Cello tests in Docker: all")
    expect(text).toContain("cello-test:pw1.65.1-bun1.4.4-0123456789")
    expect(text).toContain("583cf28 with uncommitted changes")
    expect(text).toContain("CELLO_E2E_SLOWMO=400")
    expect(text).toMatch(/^PASS {2}install {6}21s$/m)
    expect(text).toMatch(/^PASS {2}unit {9}1m 04s {3}71 files, 392 passed$/m)
    expect(text).toMatch(/^FAIL {2}desktop-e2e {2}1m 30s {3}1 failed, 1 skipped, 3 passed$/m)
    expect(text).toContain("FAILED: desktop-e2e (logs/desktop-e2e.log)")
    expect(text).toContain("web/videos: 3, desktop/videos: 4, desktop/screenshots: 3")
  })

  it("passes only when every step of the mode ran and passed", () => {
    const e2e = { ...base, mode: "e2e" as const, args: ["e2e/board.spec.ts"] }
    const passed = summarize({ ...e2e, steps: [{ name: "install", code: 0, seconds: 3 }, { name: "web-e2e", code: 0, seconds: 9 }], logs: {} })
    expect(passed).toContain("Cello tests in Docker: e2e e2e/board.spec.ts")
    expect(passed).toMatch(/^PASSED$/m)
    const stopped = summarize({ ...e2e, steps: [{ name: "install", code: 1, seconds: 3 }], logs: {} })
    expect(stopped).toContain("FAILED: install (logs/install.log); didn't run: web-e2e")
    expect(summarize({ ...base, steps: [], logs: {} })).toContain("didn't run: install, unit, typecheck, web-e2e, desktop-e2e")
  })
})
