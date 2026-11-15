import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, Label, Priority, Status, Task } from "@cello/contract/entities"
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
  createdByActorId: "me", createdBySessionId: null, updatedByActorId: null, updatedBySessionId: null, stage: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt: null, ...extra,
})

const board: BoardState = {
  seq: 1,
  actors: {},
  workspaces: {},
  projects: {},
  statuses: { todo: status },
  labels: { bug: label("bug", "Bug"), old: label("old", "Old", { archivedAt: 5 }) },
  tasks: { t1: task("t1", 1, { title: "Plan the release" }) },
  sessions: {},
  reviews: {},
  documents: {},
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

  describe("who made it, who's on it, where it is (CEL-5, CEL-35)", () => {
    const now = Date.now()
    const session: AgentSession = {
      id: "s1", actorId: "claude", externalId: "8a41c9e2-417a", clientName: "Claude Code", entrypoint: "cli", cwd: null, pid: 1,
      startedAt: now - 3_600_000, lastSeenAt: now - 30_000, endedAt: null,
    }
    const staffed: BoardState = {
      ...board,
      actors: {
        me: { id: "me", kind: "human", name: "Lucas N. Munhoz", client: null, color: "#5e6ad2", createdAt: 1 },
        claude: { id: "claude", kind: "agent", name: "Claude Code", client: "Claude Code", color: "#10b981", createdAt: 1 },
      },
      sessions: { s1: session },
    }
    const held = task("t4", 4, {
      assigneeActorId: "claude", assigneeSessionId: "s1", stage: "fixing", version: 3,
      updatedByActorId: "claude", updatedBySessionId: "s1", updatedAt: now - 4 * 60_000,
    })
    const renderIn = (state: BoardState, t: Task, laned = false) => renderToStaticMarkup(createElement(CardBody, { task: t, board: state, laned }))

    it("says who's on it, that it's active, and the stage; then who created it and who changed it last", () => {
      const html = renderIn(staffed, held)
      expect(html).toContain('data-presence="active"')
      expect(html).toMatch(/8a41c9e2<\/span> active now/)
      expect(html).toContain('data-stage="fixing"')
      expect(html).toContain("Fixing findings")
      expect(textAt(html, "data-provenance")).toBe("Lucas created · 8a41c9e2 changed 4m ago")
    })

    it("a quiet session says when it was seen, in amber; an ended one says so", () => {
      const quiet = renderIn({ ...staffed, sessions: { s1: { ...session, lastSeenAt: now - 2 * 3_600_000 } } }, held)
      expect(quiet).toContain('data-presence="idle"')
      expect(quiet).toMatch(/8a41c9e2<\/span> seen 2h ago/)
      const ended = renderIn({ ...staffed, sessions: { s1: { ...session, endedAt: now - 60_000 } } }, held)
      expect(ended).toMatch(/8a41c9e2<\/span> ended/)
    })

    it("in a laned column the lane says the stage, so the card doesn't; nobody on it means no work line", () => {
      expect(renderIn(staffed, held, true)).not.toContain("data-stage")
      expect(renderIn(staffed, task("t5", 5))).not.toContain("data-card-work")
    })
  })
})
