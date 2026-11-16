import { detectRepo } from "@cello/shared/detect"
import { describe, expect, it } from "vitest"
import { contextProfileLines, profileLines, readinessLines, wroteLines } from "./profile.ts"

const NOW = 10 * 60_000
const field = (name: string, value: string, source: "detected" | "agent" | "human", updatedAt = 0) =>
  ({ field: name, value, source, updatedAt, actorId: "a", sessionId: null })

describe("the testing profile in the CLI (CEL-89)", () => {
  it("one line per field with where it came from, and when with a time", () => {
    const fields = [field("install", "bun install", "detected", NOW - 120_000), field("e2e.web.run", "bun run test:e2e", "human", NOW)]
    expect(profileLines(fields, NOW)).toEqual([
      "install          bun install  (detected, 2m ago)",
      "e2e.web.run      bun run test:e2e  (human, just now)",
    ])
    expect(profileLines(fields)).toEqual(["install          bun install  (detected)", "e2e.web.run      bun run test:e2e  (human)"])
  })

  it("`cello context` shows the profile and what's missing, or how to start one", () => {
    expect(contextProfileLines({ projectId: "p", fields: [] })).toEqual([
      "Testing   no profile yet: `cello init` detects one, or set fields with `cello profile set <field> \"<value>\"`",
    ])
    expect(contextProfileLines({ projectId: "p", fields: [field("unit", "bun run test", "human")] })).toEqual([
      "Testing   how to test this repo and collect evidence; current best knowledge, so fix it with `cello profile set` when it's wrong",
      "  unit             bun run test  (human)",
      "  missing: install, typecheck, app.start, app.url, e2e.<surface>.run, evidence.ui, evidence.cli",
    ])
  })

  it("the readiness report says what's there and what to do", () => {
    const found = detectRepo({ paths: [], packages: [], texts: {} }, { ffmpeg: true, docker: true, playwrightBrowsers: true })
    expect(readinessLines(found)).toEqual([
      "Testing: nothing detected (no test runner, e2e tool or app found)",
      "  missing      unit tests           no unit test command found",
      "               → Add a unit test runner (Vitest: `npm add -D vitest`) and a \"test\" script.",
      "  missing      e2e video            no e2e tool found",
      "               → Set up Playwright (`npm init playwright@latest`) with use: { video: \"on\" }, so builders can record the flow headless.",
      "  missing      screenshots          no browser automation found",
      "               → Playwright (or Cypress) takes screenshots of each step; set it up with the e2e tool.",
      "  partial      terminal transcript  nothing to run yet",
      "               → Add a test script, so a transcript of it can show the change working.",
    ])
  })

  it("a field detection couldn't settle gets a line saying why, and how to set it (CEL-96)", () => {
    const found = detectRepo({
      paths: ["playwright.config.ts"],
      packages: [],
      texts: { "playwright.config.ts": "use: { baseURL: process.env.BASE_URL, video: \"on\" }" },
    }, { ffmpeg: true, docker: true, playwrightBrowsers: true })
    expect(readinessLines(found).slice(-2)).toEqual([
      "  unknown      app.url              baseURL in playwright.config.ts is `process.env.BASE_URL`, which names a variable with no default there",
      "               → Set it with `cello profile set app.url \"<value>\"` once you know it.",
    ])
  })

  it("says what init wrote into the profile and what it kept", () => {
    expect(wroteLines({ written: ["install", "unit"], kept: ["typecheck"], found: 3 })).toEqual([
      "Wrote install, unit to the testing profile; kept typecheck, which an agent or the human set. See `cello profile`.",
    ])
    expect(wroteLines({ written: [], kept: [], found: 0 })).toEqual([
      "Nothing to write to the testing profile yet. Set fields as the repo gets them: `cello profile set <field> \"<value>\"`.",
    ])
    expect(wroteLines({ written: [], kept: [], found: 4 })).toEqual(["The testing profile already has everything found. See `cello profile`."])
  })
})
