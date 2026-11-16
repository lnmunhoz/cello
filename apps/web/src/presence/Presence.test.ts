// CEL-55 + CEL-69: the (kept, unused) per-agent list and the task panel show the agent mark the cards
// show, in the same mood, next to the presence words. The sidebar's "Agents working" is one link (CEL-65). Rendered to markup: no DOM in unit tests.
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession, SessionAgent, Status, Task } from "@cello/contract/entities"
import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterContextProvider } from "@tanstack/react-router"
import { createElement, Fragment } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { AgentsWorking, AgentsWorkingList, PanelWork, ProvenanceRows } from "./Presence.tsx"

const now = Date.now()
const status = (id: string, name: string, category: Status["category"]): Status => ({
  id, workspaceId: "w1", name, category, position: "a0", color: "#999", hidden: false, createdAt: 1, updatedAt: 1,
})
const session: AgentSession = {
  id: "s1", actorId: "claude", externalId: "2fd0505c-417a", clientName: "Claude Code", entrypoint: "cli", cwd: "/repo", pid: 1,
  startedAt: now - 60_000, lastSeenAt: now - 5_000, endedAt: null,
}
const task = (id: string, number: number, extra: Partial<Task> = {}): Task => ({
  id, projectId: "p1", number, key: `CEL-${number}`, title: id, description: "", statusId: "prog", priority: 0, position: "a0",
  dueDate: null, parentId: null, labelIds: [], assigneeActorId: "claude", assigneeSessionId: "s1", createdByActorId: "lucas",
  createdBySessionId: null, updatedByActorId: null, updatedBySessionId: null, stage: null, commentCount: 0, lastCommentAt: null, version: 1,
  createdAt: 1, updatedAt: 1, archivedAt: null, ...extra,
})
const builder: SessionAgent = {
  sessionId: "s1", agentId: "a13bfb89c0de", agentType: "cello-builder", taskId: "t1", description: null,
  startedAt: now - 30_000, lastSeenAt: now - 2_000, endedAt: null,
}

const tasks = [task("t1", 1, { stage: "building" }), task("t2", 2, { statusId: "needs" })]
const board: BoardState = {
  seq: 1,
  actors: { claude: { id: "claude", kind: "agent", name: "Claude Code", client: "Claude Code", color: "#10b981", createdAt: 1 } },
  workspaces: {},
  projects: { p1: { id: "p1", workspaceId: "w1", name: "Cello", key: "CEL", color: "#000", description: "", repoPath: null, createdAt: 1, updatedAt: 1, archivedAt: null } },
  statuses: { prog: status("prog", "In Progress", "started"), needs: status("needs", "Needs input", "waiting") },
  labels: {},
  tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
  sessions: { s1: session },
  agents: { [`s1/${builder.agentId}`]: builder },
  reviews: {},
  asks: {},
  documents: {},
}

/** The opening tag of the agent mark inside the element that has `attr` (`data-x` or `data-x="v"`). */
const markIn = (html: string, attr: string) => {
  const at = html.indexOf(` ${attr}`)
  if (at < 0) return undefined
  return html.slice(at).match(/<span[^>]*class="agent-mark"[^>]*>/)?.[0]
}

/** Rendered inside a router (the sidebar's links need one), at `url`. */
const routed = (node: ReturnType<typeof createElement>, url = "/") => {
  const root = createRootRoute()
  const router = createRouter({
    routeTree: root.addChildren(["/agents", "/review"].map((path) => createRoute({ getParentRoute: () => root, path }))),
    history: createMemoryHistory({ initialEntries: [url] }),
  })
  return renderToStaticMarkup(createElement(RouterContextProvider, { router, children: node }))
}

describe("Agents working in the sidebar: one link to the Agents page, with the count (CEL-65)", () => {
  const html = routed(createElement(AgentsWorking, { board, workspaceId: "w1", className: "" }))

  it("is a link to the Agents page, with the count", () => {
    const link = html.match(/<a [^>]*data-agents-working="2"[^>]*>/)?.[0]
    expect(link).toContain('href="/agents"')
  })

  it("lists no agents under it: the Agents page does (Lucas, Nov 16)", () => {
    expect(html).not.toContain("data-agents-list")
    expect(html).not.toContain("data-working-session")
  })
})

// The per-agent list the sidebar had, kept for reference (not shown anywhere).
describe("the kept per-agent list: each entry shows the agent mark in its card's mood (CEL-55)", () => {
  const html = routed(createElement(AgentsWorkingList, { board, workspaceId: "w1" }))

  it("the subagent building its task: working, in its colour, with its presence words", () => {
    const mark = markIn(html, `data-working-agent="${builder.agentId}"`)
    expect(mark).toContain('data-agent-mood="working"')
    expect(mark).toContain('data-presence="active"')
    expect(mark).toContain("width:14px")
  })

  it("the session, whose own card waits in Needs input: waiting", () => {
    expect(markIn(html, 'data-working-session="s1"')).toContain('data-agent-mood="waiting"')
  })

  it("no plain presence dot is left in the list", () => {
    const list = html.slice(html.indexOf("data-agents-list"))
    expect(list).not.toContain("data-checked-in")
  })
})

describe("the task panel shows the card's mark (CEL-55)", () => {
  const render = (t: Task) => renderToStaticMarkup(createElement("dl", null, createElement(ProvenanceRows, { task: t, board })))
  const topBar = (t: Task) => renderToStaticMarkup(createElement(Fragment, null, createElement(PanelWork, { task: t, board })))

  it("Working on it and the top bar: the subagent building it, working", () => {
    const html = render(tasks[0]!)
    for (const [where, part] of [["data-working-on-it", html], ["data-panel-work", topBar(tasks[0]!)]] as const) {
      const mark = markIn(part, where)
      expect(mark, where).toContain('data-agent-mood="working"')
      expect(mark, where).toContain('data-presence="active"')
      expect(part, where).toContain("cello-builder · a13bfb89")
      expect(part, where).toContain("active now")
    }
  })

  it("a task waiting in Needs input: the session's mark waits", () => {
    expect(markIn(render(tasks[1]!), "data-working-on-it")).toContain('data-agent-mood="waiting"')
  })
})
