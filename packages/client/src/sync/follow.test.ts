import type { Snapshot, Task, Workspace } from "@cello/contract/entities"
import { SnapshotRequired } from "@cello/contract/errors"
import type { CelloEvent, EventBody } from "@cello/contract/events"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import { advance, defaultWorkspaceId, follow, type SyncSource, type Synced } from "./follow.ts"

const workspace = (id: string, position: string): Workspace => ({
  id,
  name: id,
  slug: id,
  position,
  createdAt: 1,
  updatedAt: 1,
  archivedAt: null,
})

const task = (id: string): Task => ({
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
})

const snapshot = (seq: number, tasks: Task[] = []): Snapshot => ({
  seq,
  actors: [],
  workspaces: [workspace("w2", "b0"), workspace("w1", "a0")],
  projects: [],
  statuses: [],
  labels: [],
  tasks,
  sessions: [], agents: [],
  reviews: [],
  asks: [],
  documents: [],
})

const ev = (seq: number, body: EventBody, commandId = `c${seq}`): CelloEvent =>
  ({
    seq,
    ts: seq,
    commandId,
    actorId: "me",
    sessionId: null,
    workspaceId: "w1",
    projectId: "p1",
    schemaVersion: 1,
    ...body,
  }) as CelloEvent

const created = (seq: number, id: string) => ev(seq, { type: "task.created", task: task(id) })

/** A source that plays scripted snapshots and streams, and records how it was called. */
const scripted = (snapshots: Snapshot[], streams: Array<Stream.Stream<CelloEvent, unknown>>) => {
  const calls: Array<{ rpc: "snapshot" | "subscribe"; scope: unknown; afterSeq?: number }> = []
  const source: SyncSource = {
    snapshot: (scope) =>
      Effect.sync(() => {
        calls.push({ rpc: "snapshot", scope })
        return snapshots.shift()!
      }),
    subscribe: (scope, afterSeq) => {
      calls.push({ rpc: "subscribe", scope, afterSeq })
      return streams.shift() ?? Stream.never
    },
  }
  return { source, calls }
}

const collect = (source: SyncSource) =>
  Effect.gen(function* () {
    const out = yield* Queue.unbounded<Synced>()
    yield* follow(source, { retryDelay: "1 second" }).pipe(
      Stream.runForEach((s) => Queue.offer(out, s)),
      Effect.forkChild,
    )
    return out
  })

describe("follow", () => {
  it.effect("takes a snapshot, then applies the stream from its seq", () =>
    Effect.gen(function* () {
      const { source, calls } = scripted([snapshot(10)], [Stream.make(created(11, "t1"), created(12, "t2"))])
      const out = yield* collect(source)
      const first = yield* Queue.take(out)
      expect(first.state.seq).toBe(10)
      expect(first.scope).toEqual({ workspaceId: "w1" })
      let last = yield* Queue.take(out)
      while (last.state.seq < 12) last = yield* Queue.take(out)
      expect(Object.keys(last.state.tasks).sort()).toEqual(["t1", "t2"])
      expect(calls.slice(0, 2)).toEqual([
        { rpc: "snapshot", scope: undefined },
        { rpc: "subscribe", scope: { workspaceId: "w1" }, afterSeq: 10 },
      ])
    }))

  it.effect("reconnects from the last seq it saw after the stream drops", () =>
    Effect.gen(function* () {
      const { source, calls } = scripted(
        [snapshot(10)],
        [Stream.concat(Stream.make(created(11, "t1")), Stream.fail(new Error("socket closed"))), Stream.make(created(12, "t2"))],
      )
      const out = yield* collect(source)
      let s = yield* Queue.take(out)
      while (s.connection !== "reconnecting") s = yield* Queue.take(out)
      expect(s.state.seq).toBe(11)
      yield* TestClock.adjust("1 second")
      while (s.state.seq < 12) s = yield* Queue.take(out)
      expect(s.connection).toBe("live")
      expect(calls.filter((c) => c.rpc === "snapshot")).toHaveLength(1)
      expect(calls.filter((c) => c.rpc === "subscribe").map((c) => c.afterSeq)).toEqual([10, 11])
    }))

  it.effect("takes a fresh snapshot on SnapshotRequired and starts a new epoch", () =>
    Effect.gen(function* () {
      const { source, calls } = scripted(
        [snapshot(10), snapshot(6000, [task("fresh")])],
        [Stream.fail(new SnapshotRequired({ latestSeq: 6000 })), Stream.make(created(6001, "t2"))],
      )
      const out = yield* collect(source)
      const first = yield* Queue.take(out)
      let s = yield* Queue.take(out)
      while (s.state.seq < 6001) s = yield* Queue.take(out)
      expect(s.epoch).toBe(first.epoch + 1)
      expect(Object.keys(s.state.tasks).sort()).toEqual(["fresh", "t2"])
      expect(calls.filter((c) => c.rpc === "subscribe").map((c) => c.afterSeq)).toEqual([10, 6000])
    }))

  it.effect("keeps a scope it was given", () =>
    Effect.gen(function* () {
      const { source, calls } = scripted([snapshot(3)], [])
      const out = yield* Queue.unbounded<Synced>()
      yield* follow(source, { scope: { projectId: "p1" } }).pipe(
        Stream.runForEach((s) => Queue.offer(out, s)),
        Effect.forkChild,
      )
      const first = yield* Queue.take(out)
      expect(first.scope).toEqual({ projectId: "p1" })
      expect(calls[0]).toEqual({ rpc: "snapshot", scope: { projectId: "p1" } })
    }))
})

describe("advance", () => {
  it("applies events and remembers which commands it has seen", () => {
    const start: Synced = {
      state: { seq: 10, actors: {}, workspaces: {}, projects: {}, statuses: {}, labels: {}, tasks: {}, sessions: {}, agents: {}, reviews: {}, asks: {}, documents: {}, wakes: {}, milestones: {} },
      scope: { workspaceId: "w1" },
      epoch: 1,
      seen: new Map(),
      connection: "live",
      batch: [],
    }
    const next = advance(start, [created(11, "t1"), ev(10, { type: "task.archived", id: "x", version: 2 }, "old")])
    expect(next.state.seq).toBe(11)
    expect(next.seen.get("c11")).toBe(11)
    expect(next.seen.has("old")).toBe(false)
    expect(next.batch.map((e) => e.seq)).toEqual([11])
  })

  it("returns the same object when nothing applies", () => {
    const start: Synced = {
      state: { seq: 10, actors: {}, workspaces: {}, projects: {}, statuses: {}, labels: {}, tasks: {}, sessions: {}, agents: {}, reviews: {}, asks: {}, documents: {}, wakes: {}, milestones: {} },
      scope: { workspaceId: "w1" },
      epoch: 1,
      seen: new Map(),
      connection: "live",
      batch: [],
    }
    expect(advance(start, [created(9, "t1")])).toBe(start)
  })
})

describe("defaultWorkspaceId", () => {
  it("picks the first workspace by position", () => {
    expect(defaultWorkspaceId(snapshot(1))).toBe("w1")
  })
})
