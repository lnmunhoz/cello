// CEL-181: how a test run reads in a task's thread, rendered to markup (no DOM in unit tests): a finished run
// with its outcome, a collapsed one with its count, and a live one with the pulsing flask.
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { TestsLine, TestsLiveLine, TimelineFold, TimelineLine } from "@cello/client/timeline"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TimelineFoldRow, TimelineLineRow } from "./TimelineEvents.tsx"

const board = {
  seq: 1,
  actors: { claude: { id: "claude", kind: "agent", name: "Claude Code", client: "Claude Code", color: "#c96", createdAt: 1 } },
  sessions: {},
  agents: {},
  statuses: {},
} as unknown as BoardState

const doer = { actorId: "claude", sessionId: null, agentId: null }
const passed: TestsLine = {
  kind: "tests", id: "tests:s:a1:1000", ts: 1_000, endedAt: 105_000, doer, label: "web e2e", outcome: "passed",
  words: "web e2e passed · e2e/pages.spec.ts · 3 of 3 · 1m44s", failures: [], command: "bun run test:e2e -- e2e/pages.spec.ts", folder: null, runs: 1, earlier: [],
}
const render = (line: TimelineLine) => renderToStaticMarkup(createElement(TimelineLineRow, { board, line }))
const text = (html: string) => html.replace(/<[^>]+>/g, "")

describe("a finished test run in the thread", () => {
  it("passed: the line kind and outcome, the check icon, the words, and the time it ended", () => {
    const html = render(passed)
    expect(html).toContain('data-timeline-line="tests"')
    expect(html).toContain('data-outcome="passed"')
    expect(html).toContain('data-timeline-id="tests:s:a1:1000"')
    expect(html).toContain("lucide-circle-check")
    expect(text(html)).toContain("web e2e passed · e2e/pages.spec.ts · 3 of 3 · 1m44s")
    // The time shown is when it ended, though the line sits where it started.
    const at = Date.now()
    const recent = text(render({ ...passed, ts: at - 600_000, endedAt: at - 120_000 }))
    expect(recent).toContain("2 min ago")
    expect(recent).not.toContain("10 min ago")
    // Nothing on it animates.
    expect(html).not.toContain("animate-")
  })

  it("failed: the danger colour on the icon and on the word, and the failures in the hover", () => {
    const html = render({
      ...passed, outcome: "failed", words: "web e2e failed · 1 failed of 3 · 1m44s", failures: ["e2e/pages.spec.ts:40 › opens"], folder: "/repo/wt/test-results/docker/run-1",
    })
    expect(html).toContain('data-outcome="failed"')
    expect(html).toContain("lucide-circle-x")
    expect(html).toContain("text-danger")
    expect(html).toContain("✘ e2e/pages.spec.ts:40 › opens")
    expect(html).toContain("/repo/wt/test-results/docker/run-1/summary.txt")
    expect(html).toContain("bun run test:e2e -- e2e/pages.spec.ts")
    expect(html).toContain("Claude Code")
  })

  it("ended: the faint minus icon", () => {
    const html = render({ ...passed, outcome: "ended", words: "web e2e ended · 1m44s" })
    expect(html).toContain('data-outcome="ended"')
    expect(html).toContain("lucide-circle-minus")
    expect(html).toContain("text-faint")
  })

  it("collapsed: says how many runs, and the earlier ones are in the hover with their failures", () => {
    const html = render({
      ...passed, label: "unit tests", words: "unit tests passed · 40s", runs: 3,
      earlier: [{ outcome: "failed", endedAt: 41_000, words: "unit tests failed · 1 failed of 4 · 40s", failures: ["a.test.ts › x"] }, { outcome: "passed", endedAt: 90_000, words: "unit tests passed · 40s", failures: [] }],
    })
    expect(text(html)).toContain("unit tests passed · 40s · 3 runs")
    expect(html).toContain("unit tests failed · 1 failed of 4 · 40s")
    expect(html).toContain("✘ a.test.ts › x")
  })
})

describe("a live test run in the thread", () => {
  const live: TestsLiveLine = {
    kind: "tests_live", id: "tests:s:a1:1000", ts: 1_000, doer, label: "web e2e", words: "web e2e · e2e/pages.spec.ts · 2 of 3 · 1m10s", failed: 0, failures: [],
    command: "bun run test:e2e -- e2e/pages.spec.ts",
  }

  it("Running, the words, the flask that pulses, and no relative time (the elapsed time is in the words)", () => {
    const html = render(live)
    expect(html).toContain('data-timeline-line="tests_live"')
    expect(html).toContain('data-timeline-id="tests:s:a1:1000"')
    expect(text(html)).toBe("Running web e2e · e2e/pages.spec.ts · 2 of 3 · 1m10s")
    expect(html).toContain("lucide-flask-conical")
    expect(html).toContain("motion-safe:animate-pulse")
    expect(html).not.toContain("ago")
    expect(html).not.toContain("just now")
  })

  it("failures so far are counted in the danger colour", () => {
    const html = render({ ...live, words: "web e2e · e2e/pages.spec.ts · 2 of 3 · 1 failed · 1m10s", failed: 1, failures: ["e2e/pages.spec.ts:40 › opens"] })
    expect(text(html)).toContain("2 of 3 · 1 failed · 1m10s")
    expect(html).toContain('<span class="font-medium text-danger">1 failed</span>')
    // With none failed, nothing is in the danger colour.
    expect(render(live)).not.toContain("text-danger")
    expect(html).toContain("✘ e2e/pages.spec.ts:40 › opens")
  })

  it("the live row and the finished line are the same row: the same key and the same data attribute for the id", () => {
    expect(render(live).match(/data-timeline-id="([^"]+)"/)?.[1]).toBe(render(passed).match(/data-timeline-id="([^"]+)"/)?.[1])
  })
})

describe("a fold with test results", () => {
  it("closed, it shows its test lines and its newest line under the button that counts only what's hidden", () => {
    const stage = (id: string, ts: number): TimelineLine => ({ kind: "stage", id, ts, stage: "building", doer })
    const lines = [stage("a", 10), passed, stage("b", 200_000), { kind: "status", id: "c", ts: 300_000, from: "In Progress", to: "In Review", doer } as TimelineLine]
    const fold: TimelineFold = { kind: "fold", id: "fold:a", lines, newest: lines[3]!, visible: [lines[1]!, lines[3]!] }
    const html = renderToStaticMarkup(createElement(TimelineFoldRow, { board, fold }))
    expect(html).toContain("2 earlier · show")
    expect(html).toContain('data-timeline-line="tests"')
    expect(html).toContain('data-timeline-line="status"')
    expect(html).not.toContain('data-timeline-line="stage"')
  })
})
