import type { Task } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import type { BoardState } from "../sync/applyEvents.ts"
import type { Synced } from "../sync/follow.ts"
import { begin, confirm, pendingOf, prune, rollback, view, type Pending } from "./optimistic.ts"
import { moveTask } from "./patches.ts"

const task = (id: string, overrides: Partial<Task> = {}): Task => ({
  id,
  projectId: "p1",
  number: 1,
  key: "CEL-1",
  title: id,
  description: "",
  statusId: "todo",
  priority: 0,
  position: "a0",
  dueDate: null,
  parentId: null,
  labelIds: [],
  assigneeActorId: null,
  assigneeSessionId: null,
  createdByActorId: "me",
  createdBySessionId: null,
  updatedByActorId: null,
  updatedBySessionId: null,
  stage: null, commentCount: 0, lastCommentAt: null,
  version: 1,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
  ...overrides,
})

const state = (seq: number, tasks: Task[]): BoardState => ({
  seq,
  actors: {},
  workspaces: {},
  projects: {},
  statuses: {},
  labels: {},
  tasks: Object.fromEntries(tasks.map((t) => [t.id, t])),
  sessions: {}, agents: {},
  reviews: {},
  asks: {},
  documents: {}, wakes: {},
})

const synced = (seq: number, tasks: Task[], extra: Partial<Synced> = {}): Synced => ({
  state: state(seq, tasks),
  scope: { workspaceId: "w1" },
  epoch: 1,
  seen: new Map(),
  connection: "live",
  batch: [],
  ...extra,
})

const move: Pending = pendingOf("cmd-1", 1, moveTask("t1", "done", "b0"))

describe("optimistic patches", () => {
  it("shows a patch at once, on top of the synced state", () => {
    const base = synced(10, [task("t1")])
    const shown = view(base, begin([], move))
    expect(shown.tasks["t1"]).toMatchObject({ statusId: "done", position: "b0" })
    expect(base.state.tasks["t1"]?.statusId).toBe("todo")
  })

  it("returns the synced state itself when nothing is pending", () => {
    const base = synced(10, [task("t1")])
    expect(view(base, [])).toBe(base.state)
  })

  it("keeps a confirmed patch until the synced seq reaches the seq the RPC returned", () => {
    const pending = confirm(begin([], move), "cmd-1", 12)
    expect(view(synced(11, [task("t1")]), pending).tasks["t1"]?.statusId).toBe("done")
    const caughtUp = synced(12, [task("t1", { statusId: "done", position: "b0", version: 2 })])
    expect(view(caughtUp, pending)).toBe(caughtUp.state)
    expect(prune(pending, caughtUp)).toEqual([])
  })

  it("drops a patch whose RPC changed nothing (seq null)", () => {
    const base = synced(10, [task("t1")])
    const pending = confirm(begin([], move), "cmd-1", null)
    expect(view(base, pending)).toBe(base.state)
  })

  it("drops a patch once an event with its command id arrives, even before the RPC returns", () => {
    const base = synced(11, [task("t1", { statusId: "done" })], { seen: new Map([["cmd-1", 11]]) })
    expect(view(base, begin([], move))).toBe(base.state)
  })

  it("rolls back when the RPC fails", () => {
    const base = synced(10, [task("t1")])
    const pending = rollback(begin([], move), "cmd-1")
    expect(view(base, pending).tasks["t1"]?.statusId).toBe("todo")
  })

  it("drops every patch when a fresh snapshot replaces the state", () => {
    const fresh = synced(6000, [task("t1")], { epoch: 2 })
    expect(view(fresh, begin([], move))).toBe(fresh.state)
    expect(prune(begin([], move), fresh)).toEqual([])
  })

  it("re-applies an unconfirmed patch on top of newer events", () => {
    const pending = begin([], move)
    const newer = synced(11, [task("t1", { title: "Renamed by Claude", version: 2 })])
    expect(view(newer, pending).tasks["t1"]).toMatchObject({ title: "Renamed by Claude", statusId: "done" })
  })
})
