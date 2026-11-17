// CEL-142: the card a task link shows on hover or focus. Rendered to markup: no DOM in unit tests (the
// hover itself, its delay, Esc and the click-through are e2e/taskpreview.spec.ts).
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, Ask, Review, Status, Task } from "@cello/contract/entities"
import { RegistryProvider } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { boardAtom } from "../lib/cello.ts"
import { TaskPreview } from "./TaskPreview.tsx"

// lib/cello.ts builds the socket's address from the page's location when it loads.
vi.hoisted(() => Object.assign(globalThis, { location: { protocol: "http:", host: "localhost:4747", origin: "http://localhost:4747" } }))

const now = Date.now()
const status = (id: string, name: string, category: Status["category"], color: string): Status => ({
  id, workspaceId: "w1", name, category, position: "a0", color, hidden: false, createdAt: 1, updatedAt: 1,
})
const task = (id: string, number: number, extra: Partial<Task> = {}): Task => ({
  id, projectId: "p1", number, key: `THAI-${number}`, title: `Task ${number}`, description: "", statusId: "todo", priority: 0, position: "a0",
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null, createdByActorId: "me", createdBySessionId: null,
  updatedByActorId: null, updatedBySessionId: null, stage: null, commentCount: 0, lastCommentAt: null, version: 1, createdAt: now - 86_400_000, updatedAt: now - 86_400_000, archivedAt: null, ...extra,
})
const session: AgentSession = {
  id: "s1", actorId: "claude", externalId: "8a41c9e2-417a", clientName: "Claude Code", entrypoint: "cli", cwd: null, pid: 1,
  startedAt: now - 3_600_000, lastSeenAt: now - 5_000, endedAt: null,
}
const ask: Ask = {
  id: "k1", taskId: "t2", title: "Which import first?", intro: "", attachments: [], actorId: "claude", sessionId: "s1",
  questions: [{ id: "q1", prompt: "Import first?", kind: "text", options: [] }, { id: "q2", prompt: "Export too?", kind: "text", options: [] }],
  author: { name: "Claude Code", session: "8a41c9e2" }, state: "open", createdAt: now, answeredAt: null, answers: null, withdrawnAt: null, withdrawnBy: null,
}
const packet: Review = {
  id: "r1", taskId: "t3", summary: "", steps: [], attachments: [], actorId: "claude", sessionId: "s1", author: { name: "Claude Code", session: "8a41c9e2" },
  createdAt: now, decidedAt: null, decision: null, decisionNote: null,
}

const tasks = [
  task("t1", 96, {
    title: "Show baht prices", priority: 2, labelIds: ["bug"], milestoneId: "m1",
    description: "Prices read in **baht** on the plan page.\n\nSee THAI-2 for the import.\n\nA third paragraph.\n\nA fourth that stays out.",
  }),
  task("t2", 2, {
    title: "Import the bookmarks", statusId: "needs", assigneeActorId: "claude", assigneeSessionId: "s1", stage: "building",
    version: 3, updatedByActorId: "claude", updatedBySessionId: "s1", updatedAt: now - 4 * 60_000,
  }),
  task("t3", 3, { statusId: "review" }),
]
const board: BoardState = {
  seq: 1,
  actors: {
    me: { id: "me", kind: "human", name: "Lucas N. Munhoz", client: null, color: "#5e6ad2", createdAt: 1 },
    claude: { id: "claude", kind: "agent", name: "Claude Code", client: "Claude Code", color: "#10b981", createdAt: 1 },
  },
  workspaces: {},
  projects: { p1: { id: "p1", workspaceId: "w1", name: "Thai Lookup", key: "THAI", color: "#000", description: "", repoPath: null, mergeAfterApproval: false, createdAt: 1, updatedAt: 1, archivedAt: null } },
  statuses: {
    todo: status("todo", "Todo", "unstarted", "#999999"),
    needs: status("needs", "Needs input", "waiting", "#e2653b"),
    review: status("review", "In Review", "started", "#f2c94c"),
  },
  labels: { bug: { id: "bug", workspaceId: "w1", projectId: "p1", name: "Bug", color: "#eb5757", group: "none", createdAt: 1, updatedAt: 1, archivedAt: null } },
  milestones: { m1: { id: "m1", projectId: "p1", name: "Launch", goal: "", targetDate: null, position: "a0", state: "open", closedAt: null, createdAt: 1, updatedAt: 1 } },
  tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
  sessions: { s1: session },
  agents: {},
  reviews: { r1: packet },
  asks: { k1: ask },
  documents: {},
  wakes: {},
}

const render = (key: string) =>
  renderToStaticMarkup(
    createElement(RegistryProvider, { initialValues: [[boardAtom, AsyncResult.success(board)]] }, createElement(TaskPreview, { task: board.tasks[Object.keys(board.tasks).find((id) => board.tasks[id]!.key === key)!]!, board })),
  )

/** The markup inside the first element with `attr`, up to its own closing tag's neighbourhood: enough to search in. */
const partAt = (html: string, attr: string) => {
  const at = html.indexOf(` ${attr}`)
  return at < 0 ? "" : html.slice(html.lastIndexOf("<", at))
}

describe("TaskPreview", () => {
  const html = render("THAI-96")

  it("names the task: its key, its title (a link to it), and its status in the status's colour", () => {
    expect(html).toContain('data-task-preview="THAI-96"')
    expect(partAt(html, "data-preview-key")).toMatch(/^<[^>]*>THAI-96</)
    expect(partAt(html, "data-preview-title")).toMatch(/^<a [^>]*href="\/THAI\/96"[^>]*>Show baht prices<\/a>/)
    const statusPart = partAt(html, "data-preview-status")
    expect(statusPart).toMatch(/^<span[^>]*>.*Todo<\/span>/)
    expect(statusPart).toContain("#999999")
  })

  it("shows its priority, labels and milestone, as the card's chips do; the milestone even when cards hide it", () => {
    expect(html).toContain('aria-label="High"')
    expect(html).toContain(">Bug<")
    expect(html).toContain(">Launch<")
  })

  it("says Nobody when nobody is on it", () => {
    expect(partAt(html, "data-preview-work")).toMatch(/^<[^>]*>.*Nobody on it/)
  })

  it("renders the first lines of its description, task keys linked, and leaves the rest out", () => {
    const description = partAt(html, "data-preview-description")
    expect(description).toContain("<strong>baht</strong>")
    expect(description).toContain('data-task-link="THAI-2"')
    expect(description).toContain("A third paragraph.")
    expect(description).not.toContain("A fourth that stays out.")
    expect(html).toContain("data-preview-more")
  })

  it("says who created it and who changed it last", () => {
    expect(html).toMatch(/data-provenance[^>]*>Lucas created /)
    expect(render("THAI-2")).toMatch(/data-provenance[^>]*>Lucas created · 8a41c9e2 changed 4m ago</)
  })

  it("with an agent on it: the agent's mark and name, where its session runs, and the stage", () => {
    const work = partAt(render("THAI-2"), "data-preview-work")
    expect(work).toContain('class="agent-mark"')
    expect(work).toMatch(/8a41c9e2<\/span>/)
    expect(work).toContain('data-origin="terminal"')
    expect(work).toContain('data-stage="building"')
  })

  it("an open ask: Needs your input, with how many questions and the ask's title", () => {
    const waiting = partAt(render("THAI-2"), "data-preview-ask")
    expect(waiting).toContain("Needs your input · 2 questions")
    expect(waiting).toContain("Which import first?")
    expect(html).not.toContain("data-preview-ask")
  })

  it("an open review packet: waiting for your review", () => {
    expect(partAt(render("THAI-3"), "data-preview-review")).toContain("Review packet waiting for you")
    expect(html).not.toContain("data-preview-review")
  })

  it("no description: no description part", () => {
    expect(render("THAI-3")).not.toContain("data-preview-description")
  })
})
