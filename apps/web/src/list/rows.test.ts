import type { ListGroup } from "@cello/client/sync/list"
import type { Status, Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { isCollapsed, keyChars, nextRow, rowOrder } from "./rows.ts"

const status = (id: string, hidden = false): Status => ({
  id, workspaceId: "w1", name: id, category: "unstarted", position: "a0", color: "#999", hidden, createdAt: 1, updatedAt: 1,
})
const task = (id: string, extra: Partial<Task> = {}): Task => ({
  id, projectId: "p1", number: 1, key: `CEL-${id}`, title: id, description: "", statusId: "s", priority: 0, position: "a0",
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null, createdByActorId: "me",
  createdBySessionId: null, updatedByActorId: null, updatedBySessionId: null, stage: null, commentCount: 0, lastCommentAt: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt: null, ...extra,
})

const todo: ListGroup = { status: status("todo"), tasks: [task("1"), task("2")] }
const review: ListGroup = { status: status("review"), tasks: [] }
const done: ListGroup = { status: status("done"), tasks: [task("3"), task("new", { number: 0, key: "CEL-…" })] }
const backlog: ListGroup = { status: status("backlog", true), tasks: [task("4")] }
const groups = [todo, review, done, backlog]

describe("isCollapsed", () => {
  it("opens visible statuses and folds hidden ones by default", () => {
    expect(isCollapsed(todo, {}, null)).toBe(false)
    expect(isCollapsed(backlog, {}, null)).toBe(true)
  })

  it("opens a hidden status that holds the open task", () => {
    expect(isCollapsed(backlog, {}, "4")).toBe(false)
    expect(isCollapsed(backlog, {}, "1")).toBe(true)
  })

  it("follows what you chose over the default", () => {
    expect(isCollapsed(todo, { todo: true }, null)).toBe(true)
    expect(isCollapsed(backlog, { backlog: false }, null)).toBe(false)
    expect(isCollapsed(backlog, { backlog: true }, "4")).toBe(true)
  })
})

describe("rowOrder", () => {
  it("lists the rows of open groups top to bottom, leaving out tasks still being created", () => {
    expect(rowOrder(groups, (g) => isCollapsed(g, {}, null))).toEqual(["1", "2", "3"])
    expect(rowOrder(groups, (g) => g.status.id === "todo")).toEqual(["3", "4"])
  })
})

describe("nextRow", () => {
  const rows = ["1", "2", "3"]

  it("steps down and up, stopping at the ends", () => {
    expect(nextRow(rows, "1", "ArrowDown")).toBe("2")
    expect(nextRow(rows, "3", "ArrowDown")).toBe("3")
    expect(nextRow(rows, "2", "ArrowUp")).toBe("1")
    expect(nextRow(rows, "1", "ArrowUp")).toBe("1")
  })

  it("jumps to the first and last row with Home and End", () => {
    expect(nextRow(rows, "2", "Home")).toBe("1")
    expect(nextRow(rows, "2", "End")).toBe("3")
  })

  it("starts from the top (or the bottom, going up) when no row has focus or it went away", () => {
    expect(nextRow(rows, null, "ArrowDown")).toBe("1")
    expect(nextRow(rows, "gone", "ArrowDown")).toBe("1")
    expect(nextRow(rows, null, "ArrowUp")).toBe("3")
  })

  it("gives nothing for other keys or an empty list", () => {
    expect(nextRow(rows, "1", "Enter")).toBeNull()
    expect(nextRow([], null, "ArrowDown")).toBeNull()
  })
})

describe("keyChars", () => {
  it("sizes the key column for the longest key, with room for two-digit numbers", () => {
    expect(keyChars([todo, done])).toBe(6)
    expect(keyChars([{ status: status("x"), tasks: [task("1", { key: "THAILOOKUP-1234" })] }])).toBe(15)
    expect(keyChars([])).toBe(6)
  })
})
