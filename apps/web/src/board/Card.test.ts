import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Label, Priority, Status, Task } from "@cello/contract/entities"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { CardBody } from "./Card.tsx"

const status: Status = {
  id: "todo", workspaceId: "w1", name: "Todo", category: "unstarted", position: "a0", color: "#999", hidden: false, createdAt: 1, updatedAt: 1,
}
const label = (id: string, name: string, extra: Partial<Label> = {}): Label => ({
  id, workspaceId: "w1", name, color: "#5e6ad2", createdAt: 1, updatedAt: 1, archivedAt: null, ...extra,
})
const task = (id: string, number: number, extra: Partial<Task> = {}): Task => ({
  id, projectId: "p1", number, key: `CEL-${number}`, title: `Task ${number}`, description: "", statusId: "todo", priority: 0,
  position: "a0", dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null,
  createdByActorId: "me", createdBySessionId: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt: null, ...extra,
})

const board: BoardState = {
  seq: 1,
  actors: {},
  workspaces: {},
  projects: {},
  statuses: { todo: status },
  labels: { bug: label("bug", "Bug"), old: label("old", "Old", { archivedAt: 5 }) },
  tasks: { t1: task("t1", 1, { title: "Plan the release" }) },
}

/** The card's markup. Tests read it as text: there is no DOM in the unit tests. */
const render = (t: Task) => renderToStaticMarkup(createElement(CardBody, { task: t, board }))
/** The text inside the first element that has `attr`, when it holds no other elements. */
const textAt = (html: string, attr: string) => html.match(new RegExp(`<[^>]*\\s${attr}(?:="[^"]*")?[^>]*>([^<]*)<`))?.[1]

describe("CardBody", () => {
  it("shows nothing in the priority slot when a task has no priority", () => {
    const html = render(task("t2", 2))
    expect(html).not.toContain("No priority")
    // With no priority, due date or labels, there is no empty chip row either.
    expect(html).not.toContain("data-card-chips")
  })

  it("shows the priority icon for priorities 1 to 4", () => {
    const names: Record<Exclude<Priority, 0>, string> = { 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" }
    for (const [priority, name] of Object.entries(names)) {
      const html = render(task("t2", 2, { priority: Number(priority) as Priority }))
      expect(html).toContain("data-card-chips")
      expect(html).toContain(`aria-label="${name}"`)
    }
  })

  it("shows open labels and leaves archived ones out", () => {
    const html = render(task("t2", 2, { labelIds: ["bug", "old"] }))
    expect(html).toContain(">Bug<")
    expect(html).not.toContain(">Old<")
  })

  it("shows the parent breadcrumb after the key of a sub-task", () => {
    const html = render(task("t2", 2, { parentId: "t1" }))
    expect(textAt(html, "data-card-key")).toBe("CEL-2")
    expect(textAt(html, "data-card-parent")).toBe("Plan the release")
    expect(html).toContain('title="Sub-task of CEL-1 Plan the release"')
    expect(render(task("t3", 3))).not.toContain("data-card-parent")
  })
})
