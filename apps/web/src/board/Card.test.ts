import type { BoardState } from "@cello/client/sync/applyEvents"
import { type AgentSession, agentKey, type Label, type Priority, type SessionAgent, type Status, type Task } from "@cello/contract/entities"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { provenanceOf, sessionColor } from "../presence/model.ts"
import { CardBody } from "./Card.tsx"

const status: Status = {
  id: "todo", workspaceId: "w1", name: "Todo", category: "unstarted", position: "a0", color: "#999", hidden: false, createdAt: 1, updatedAt: 1,
}
const label = (id: string, name: string, extra: Partial<Label> = {}): Label => ({
  id, workspaceId: "w1", projectId: "p1", name, color: "#5e6ad2", group: "none", createdAt: 1, updatedAt: 1, archivedAt: null, ...extra,
})
const task = (id: string, number: number, extra: Partial<Task> = {}): Task => ({
  id, projectId: "p1", number, key: `CEL-${number}`, title: `Task ${number}`, description: "", statusId: "todo", priority: 0,
  position: "a0", dueDate: null, parentId: null, labelIds: [], assigneeActorId: null, assigneeSessionId: null,
  createdByActorId: "me", createdBySessionId: null, updatedByActorId: null, updatedBySessionId: null, stage: null, commentCount: 0, lastCommentAt: null, version: 1, createdAt: 1, updatedAt: 1, archivedAt: null, ...extra,
})

const board: BoardState = {
  seq: 1,
  actors: {},
  workspaces: {},
  projects: {},
  statuses: { todo: status },
  labels: { bug: label("bug", "Bug"), old: label("old", "Old", { archivedAt: 5 }) },
  tasks: { t1: task("t1", 1, { title: "Plan the release" }) },
  sessions: {}, agents: {},
  reviews: {},
  asks: {},
  documents: {}, wakes: {},
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

  it("titleLink wraps the title, so a card can be a container with its title as the link", () => {
    const html = renderToStaticMarkup(createElement(CardBody, {
      task: task("t2", 2, { title: "Ship it" }),
      board,
      titleLink: (title) => createElement("a", { href: "/CEL/2", "data-title-link": "" }, title),
    }))
    expect(html).toMatch(/<span[^>]*data-card-title[^>]*><a href="\/CEL\/2" data-title-link="">Ship it<\/a><\/span>/)
    expect(render(task("t2", 2))).not.toContain("<a ")
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

    it("a fresh comment: the line says who commented and when, next to how many comments it has", () => {
      const commented = { ...held, version: 4, updatedAt: now - 5_000, commentCount: 3, lastCommentAt: now - 5_000 }
      const html = renderIn(staffed, commented)
      expect(textAt(html, "data-provenance")).toBe("Lucas created · 8a41c9e2 commented just now")
      expect(html).toContain('data-comment-count="3"')
      expect(html).toContain('aria-label="3 comments"')
      expect(renderIn(staffed, { ...commented, commentCount: 1 })).toContain('aria-label="1 comment"')
      expect(renderIn(staffed, held)).not.toContain("data-comment-count")
    })

    it("in a laned column the lane says the stage, so the card doesn't; nobody on it means no work line", () => {
      expect(renderIn(staffed, held, true)).not.toContain("data-stage")
      expect(renderIn(staffed, task("t5", 5))).not.toContain("data-card-work")
    })

    it("work={false} leaves the work line out, for a place that already names the agent (the Agents page)", () => {
      expect(renderIn(staffed, held)).toContain("data-card-work")
      const html = renderToStaticMarkup(createElement(CardBody, { task: held, board: staffed, work: false }))
      expect(html).not.toContain("data-card-work")
      expect(html).not.toContain("data-stage")
      // The rest of the card stays.
      expect(textAt(html, "data-provenance")).toBe("Lucas created · 8a41c9e2 changed 4m ago")
    })

    describe("the agent mark in place of the presence dot (CEL-69)", () => {
      const statuses = {
        ...board.statuses,
        needs: { ...status, id: "needs", name: "Needs input", category: "waiting" as const },
        review: { ...status, id: "review", name: "In Review", category: "started" as const },
      }
      const withStatuses = { ...staffed, statuses }
      /** The opening tag of the card's agent mark. */
      const markOf = (html: string) => html.match(/<span[^>]*class="agent-mark"[^>]*>/)?.[0] ?? ""

      it("leads the work line with the agent in the session's colour, white eyes, working while it fixes findings", () => {
        const html = renderIn(withStatuses, held)
        const mark = markOf(html)
        expect(mark).toContain('data-agent-mood="working"')
        expect(mark).toContain('data-presence="active"')
        expect(mark).toContain(`--agent-body:${sessionColor(session)}`)
        expect(mark).toContain("--agent-eye:white")
        // The dot is gone from the card.
        expect(html).not.toContain("rounded-full")
      })

      it("thinks with no stage; waits in Needs input; rests once In Review; nothing plays as the board first draws", () => {
        expect(markOf(renderIn(withStatuses, { ...held, stage: null }))).toContain('data-agent-mood="thinking"')
        const waiting = markOf(renderIn(withStatuses, { ...held, statusId: "needs" }))
        expect(waiting).toContain('data-agent-mood="waiting"')
        expect(waiting).not.toContain("data-play")
        const done = markOf(renderIn(withStatuses, { ...held, statusId: "review" }))
        expect(done).toContain('data-agent-mood="done"')
        expect(done).not.toContain("data-play")
      })

      it("keeps still when the session is quiet (amber) or has ended (grey), as the dot's rings did", () => {
        const quiet = markOf(renderIn({ ...withStatuses, sessions: { s1: { ...session, lastSeenAt: now - 2 * 3_600_000 } } }, held))
        expect(quiet).toContain('data-agent-mood="still"')
        expect(quiet).toContain("--agent-body:var(--idle)")
        const ended = markOf(renderIn({ ...withStatuses, sessions: { s1: { ...session, endedAt: now - 60_000 } } }, held))
        expect(ended).toContain('data-agent-mood="still"')
        expect(ended).toContain("--agent-body:var(--faint)")
      })

      it("an edge in the agent's colour while it's at work on the task, and none when it's quiet, ended, or waiting on Lucas (CEL-76)", () => {
        const edgeOf = (html: string) => html.match(/<span[^>]*data-activity-edge[^>]*>/)?.[0] ?? null
        const working = edgeOf(renderIn(withStatuses, held))
        expect(working).toContain(`background:${sessionColor(session)}`)
        // Thinking (no stage yet) is at work too.
        expect(edgeOf(renderIn(withStatuses, { ...held, stage: null }))).not.toBeNull()
        expect(edgeOf(renderIn({ ...withStatuses, sessions: { s1: { ...session, lastSeenAt: now - 2 * 3_600_000 } } }, held))).toBeNull()
        expect(edgeOf(renderIn({ ...withStatuses, sessions: { s1: { ...session, endedAt: now - 60_000 } } }, held))).toBeNull()
        expect(edgeOf(renderIn(withStatuses, { ...held, statusId: "needs" }))).toBeNull()
        expect(edgeOf(renderIn(withStatuses, task("t5", 5)))).toBeNull()
        // As the board first draws, nothing plays: no flash, no turn.
        const html = renderIn(withStatuses, held)
        expect(html).not.toContain("activity-edge-flash")
        expect(html).not.toContain("status-turn")
      })

      it("follows whoever the line names: a subagent working on the task gets the mark, in its colour (CEL-55)", () => {
        const builder: SessionAgent = {
          sessionId: "s1", agentId: "a13bfb89c0de1234", agentType: "cello-builder", taskId: "t4", description: null,
          startedAt: now - 60_000, lastSeenAt: now - 10_000, endedAt: null,
        }
        const state = { ...withStatuses, agents: { [agentKey("s1", builder.agentId)]: builder } }
        const who = provenanceOf(state, held, now).holder!.who
        expect(who.color).not.toBe(sessionColor(session))
        const html = renderIn(state, held)
        expect(html).toContain('data-agent="a13bfb89c0de1234"')
        const mark = markOf(html)
        expect(mark).toContain(`--agent-body:${who.color}`)
        expect(mark).toContain('data-agent-mood="working"')
      })
    })
  })
})
