import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Milestone, Status } from "@cello/contract/entities"
import { localDay, milestoneProgress } from "@cello/domain/milestone"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { DueWords, ProgressBar } from "./parts.tsx"

const status = (id: string, name: string, category: Status["category"], color: string, position: string): Status => ({
  id, workspaceId: "w1", name, category, position, color, hidden: false, createdAt: 1, updatedAt: 1,
})
const statuses = [
  status("backlog", "Backlog", "backlog", "#9CA3AF", "a0"),
  status("todo", "Todo", "unstarted", "#6B7280", "a1"),
  status("doing", "In Progress", "started", "#F59E0B", "a2"),
  status("review", "In Review", "started", "#8B5CF6", "a3"),
  status("done", "Done", "completed", "#123456", "a4"),
]
const board = { statuses: Object.fromEntries(statuses.map((s) => [s.id, s])) } as unknown as BoardState
const tasks = (...ids: string[]) => ids.map((statusId) => ({ statusId, archivedAt: null }))

describe("ProgressBar (CEL-132)", () => {
  it("draws Done, In Review, In Progress and Todo in their statuses' colours, then Backlog as the tail, each as wide as its share", () => {
    const progress = milestoneProgress(tasks("done", "done", "review", "doing", "todo", "backlog", "backlog", "backlog"), statuses)
    const html = renderToStaticMarkup(createElement(ProgressBar, { progress, board, workspaceId: "w1" }))
    expect([...html.matchAll(/data-segment="([^"]+)"/g)].map((m) => m[1])).toEqual(["done", "in-review", "in-progress", "todo", "backlog"])
    expect(html).toContain('data-segment="done" style="width:25%;background:#123456"')
    expect(html).toContain('data-segment="backlog" style="width:37.5%')
    expect(html).toContain('aria-label="2 of 8 done · 25%, 1 in review, 1 in progress, 1 to do, 3 in Backlog"')
  })

  it("an empty milestone is an empty track", () => {
    const html = renderToStaticMarkup(createElement(ProgressBar, { progress: milestoneProgress([], statuses), board, workspaceId: "w1" }))
    expect(html).not.toContain("data-segment")
    expect(html).toContain('aria-label="0 of 0 done"')
  })
})

describe("DueWords (CEL-132)", () => {
  const milestone = (targetDate: string | null): Milestone => ({
    id: "m3", projectId: "p1", name: "M3", goal: "", targetDate, position: "a0", state: "open", closedAt: null, createdAt: 1, updatedAt: 1,
  })
  const render = (targetDate: string | null) => renderToStaticMarkup(createElement(DueWords, { milestone: milestone(targetDate) }))

  it("says how many days are left, or how late it is, marked late", () => {
    expect(render(localDay(Date.now() + 3 * 86_400_000))).toContain(">3 days left<")
    const late = render(localDay(Date.now() - 4 * 86_400_000))
    expect(late).toContain(">4 days late<")
    expect(late).toContain('data-due="late"')
  })

  it("says nothing without a date", () => {
    expect(render(null)).toBe("")
  })
})
