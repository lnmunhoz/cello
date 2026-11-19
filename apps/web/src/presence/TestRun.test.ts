// CEL-134: a test run on screen, rendered to markup (no DOM in unit tests): the card's compact word, the
// task panel's, the Agents page line, and the open row's facts; nothing once the run ended or went stale.
import type { TestRun } from "@cello/contract/entities"
import { STALE_RUN_MS } from "@cello/domain/testRun"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TestRunFacts, TestRunLine, TestRunWord } from "./TestRun.tsx"

const now = Date.now()
const progress = {
  stage: "web-e2e", passed: 6, failed: 1, skipped: 0, total: 13, current: "e2e/agents-page.spec.ts",
  failures: ["e2e/agents-page.spec.ts:40 › keys move between rows"], done: false, outcome: null, folder: null,
}
const run = (extra: Partial<TestRun> = {}): TestRun => ({
  label: "web e2e", command: "bun run test:docker:e2e -- e2e/agents-page.spec.ts", startedAt: now - 192_300, endedAt: null, outcome: null,
  background: true, progress, ...extra,
})
const text = (html: string) => html.replace(/<[^>]+>/g, "")

describe("TestRunWord", () => {
  it("the task panel's: running web e2e 7/13, its failures in red; the card's: 7/13 alone; the whole run in the hover", () => {
    const panel = renderToStaticMarkup(createElement(TestRunWord, { run: run() }))
    expect(text(panel)).toBe("·running web e2e 7/13· 1 failed")
    expect(panel).toContain("text-danger")
    expect(panel).toContain(`title="web e2e 7 of 13 · 1 failed · 3m12s\n✘ e2e/agents-page.spec.ts:40 › keys move between rows"`)
    expect(text(renderToStaticMarkup(createElement(TestRunWord, { run: run({ progress: null }), compact: true })))).toBe("·tests")
    expect(text(renderToStaticMarkup(createElement(TestRunWord, { run: run(), compact: true })))).toBe("·7/13· 1 failed")
  })

  it("shows nothing for no run, an ended one, or one whose end was surely missed", () => {
    expect(renderToStaticMarkup(createElement(TestRunWord, { run: null }))).toBe("")
    expect(renderToStaticMarkup(createElement(TestRunWord, { run: run({ endedAt: now, outcome: "passed" }) }))).toBe("")
    expect(renderToStaticMarkup(createElement(TestRunWord, { run: run({ startedAt: now - STALE_RUN_MS - 1 }) }))).toBe("")
  })
})

describe("TestRunLine and TestRunFacts", () => {
  it("the Agents page line: Running tests, where it is, its failures apart, and a bar as far as it got", () => {
    const html = renderToStaticMarkup(createElement(TestRunLine, { run: run() }))
    expect(text(html)).toBe("·Running testsweb e2e 7 of 13 · 3m12s1 failed")
    expect(html).toContain("width:54%")
  })

  it("the open row: the last run once it ended, each failure, its summary and command", () => {
    const html = renderToStaticMarkup(createElement(TestRunFacts, {
      run: run({ endedAt: now, outcome: "failed", progress: { ...progress, passed: 12, done: true, outcome: "failed", folder: "/repo/test-results/docker/run-1" } }),
    }))
    expect(text(html)).toContain("Last run: web e2e failed · 1 failed of 13 · 3m12s")
    expect(text(html)).toContain("✘ e2e/agents-page.spec.ts:40 › keys move between rows")
    expect(text(html)).toContain("test-results/docker/run-1/summary.txt")
    expect(text(html)).toContain("bun run test:docker:e2e -- e2e/agents-page.spec.ts")
  })
})
