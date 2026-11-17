// CEL-142: a task link previews its task on hover or focus (TaskPreview.tsx), and its click still opens
// the task (CEL-141). Rendered to markup: no DOM in unit tests (e2e/taskpreview.spec.ts hovers it).
import type { Status, Task } from "@cello/contract/entities"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { TaskKey, TaskLink } from "./TaskKey.tsx"

// lib/cello.ts (the card reads the board) builds the socket's address from the page's location when it loads.
vi.hoisted(() => Object.assign(globalThis, { location: { protocol: "http:", host: "localhost:4747" } }))

const status: Status = { id: "todo", workspaceId: "w1", name: "Todo", category: "unstarted", position: "a0", color: "#999", hidden: false, createdAt: 1, updatedAt: 1 }
const task: Task = {
  id: "t96", projectId: "p1", number: 96, key: "THAI-96", title: "Show baht prices", description: "", statusId: "todo", priority: 0, position: "a0",
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null, createdByActorId: "me", createdBySessionId: null,
  updatedByActorId: null, updatedBySessionId: null, stage: null, commentCount: 0, lastCommentAt: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt: null,
}

/** The opening tag of the link. */
const linkOf = (html: string) => html.match(/<a [^>]*>/)?.[0] ?? ""

describe("TaskLink", () => {
  it("is a link to the task on its board that opens a card about it on hover or focus", () => {
    const link = linkOf(renderToStaticMarkup(createElement(TaskLink, { taskKey: "THAI-96", children: "THAI-96" })))
    expect(link).toContain('href="/THAI/96"')
    expect(link).toContain('data-slot="hover-card-trigger"')
  })

  it("preview={false}: a plain link, for a place that already shows the task (the card's own title, an Agents card)", () => {
    const link = linkOf(renderToStaticMarkup(createElement(TaskLink, { taskKey: "THAI-96", preview: false, children: "THAI-96" })))
    expect(link).toContain('href="/THAI/96"')
    expect(link).not.toContain("hover-card")
    expect(link).not.toContain("preview")
  })
})

describe("TaskKey", () => {
  it("has no browser tooltip: the card names the task, and two at once would cover each other", () => {
    const link = linkOf(renderToStaticMarkup(createElement(TaskKey, { found: { task, status } })))
    expect(link).toContain('data-task-link="THAI-96"')
    expect(link).toContain('data-slot="hover-card-trigger"')
    expect(link).not.toContain("title=")
  })
})
