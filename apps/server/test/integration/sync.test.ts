// Tests 11–13: live sync between clients, reconnecting from a seq, the replay limit, and commits
// that land while a subscriber is replaying.
import { newCommandId } from "@cello/client/client"
import { isReadable, type StreamedEvent } from "@cello/contract/events"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import { MAX_REPLAY } from "../../src/events/EventLog.ts"
import { connect, startServer, tempDataDir, withClient } from "./harness.ts"

/** The seeded workspace, and a project in it. */
const setup = (client: Effect.Success<ReturnType<typeof connect>>) =>
  Effect.gen(function* () {
    const snapshot = yield* client["snapshot.get"]({})
    const workspace = snapshot.workspaces[0]!
    const { result: project } = yield* client["project.create"]({
      commandId: newCommandId(),
      workspaceId: workspace.id,
      name: "Cello",
      key: "CEL",
    })
    return { workspace, project }
  })

/** The next `n` events. The server runs this build, so it sends none this client can't read. */
const next = (stream: Stream.Stream<StreamedEvent, unknown>, n: number) =>
  stream.pipe(Stream.filter(isReadable), Stream.take(n), Stream.runCollect)

describe("sync", () => {
  it.live("two clients: A creates a task, B receives it; B reconnects from its last seq and gets what it missed", () =>
    Effect.gen(function* () {
      const { port } = yield* startServer(yield* tempDataDir)
      const a = yield* connect(port)
      const { workspace, project } = yield* setup(a)
      const scope = { workspaceId: workspace.id }

      const lastSeq = yield* withClient(port, (b) =>
        Effect.gen(function* () {
          const snapshot = yield* b["snapshot.get"]({ scope })
          const received = yield* Effect.forkChild(next(b["events.subscribe"]({ scope, afterSeq: snapshot.seq }), 1))
          const { result: task, seq } = yield* a["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Live" })
          const [event] = yield* Fiber.join(received)
          expect(event).toMatchObject({ type: "task.created", seq, task: { id: task.id, key: "CEL-1" } })
          return event!.seq
        }))

      // B is gone. A keeps working.
      const missed = yield* a["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Missed" })
      const moved = yield* a["task.move"]({
        commandId: newCommandId(),
        id: missed.result.id,
        statusId: (yield* a["snapshot.get"]({ scope })).statuses.find((s) => s.name === "Done")!.id,
      })

      const caughtUp = yield* withClient(port, (b) => next(b["events.subscribe"]({ scope, afterSeq: lastSeq }), 2))
      expect(caughtUp.map((e) => [e.seq, e.type])).toEqual([
        [missed.seq, "task.created"],
        [moved.seq, "task.moved"],
      ])
    }).pipe(Effect.scoped))

  it.live(`more than ${MAX_REPLAY} missed events: SnapshotRequired, then a fresh snapshot and carry on`, () =>
    Effect.gen(function* () {
      const { port } = yield* startServer(yield* tempDataDir)
      const a = yield* connect(port)
      const { workspace, project } = yield* setup(a)
      const scope = { workspaceId: workspace.id }
      const b = yield* connect(port)
      const stale = yield* b["snapshot.get"]({ scope })

      const { result: label } = yield* a["label.create"]({
        commandId: newCommandId(),
        projectId: project.id,
        name: "L0",
        color: "#FF0000",
      })
      yield* Effect.forEach(
        Array.from({ length: MAX_REPLAY }, (_, i) => i + 1),
        (i) => a["label.update"]({ commandId: newCommandId(), id: label.id, name: `L${i}` }),
        { concurrency: 32, discard: true },
      )

      const error = yield* b["events.subscribe"]({ scope, afterSeq: stale.seq }).pipe(Stream.runCollect, Effect.flip)
      expect(error).toMatchObject({ _tag: "SnapshotRequired" })
      const fresh = yield* b["snapshot.get"]({ scope })
      expect(fresh.seq).toBe((error as { latestSeq: number }).latestSeq)
      expect(fresh.labels[0]!.name).toBe(`L${MAX_REPLAY}`)

      const live = yield* Effect.forkChild(next(b["events.subscribe"]({ scope, afterSeq: fresh.seq }), 1))
      const { seq } = yield* a["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "After" })
      expect((yield* Fiber.join(live)).map((e) => e.seq)).toEqual([seq])
    }).pipe(Effect.scoped), 60_000)

  it.live("events committed while a subscriber is replaying are neither lost nor duplicated", () =>
    Effect.gen(function* () {
      const { port } = yield* startServer(yield* tempDataDir)
      const a = yield* connect(port)
      const { workspace, project } = yield* setup(a)
      const scope = { workspaceId: workspace.id }
      const write = (title: string) => a["task.create"]({ commandId: newCommandId(), projectId: project.id, title })

      // A backlog to replay, then writes racing the subscriber's replay.
      yield* Effect.forEach(Array.from({ length: 2_000 }, (_, i) => `Old ${i}`), write, { concurrency: 32, discard: true })
      const backlog = (yield* a["snapshot.get"]({ scope })).seq
      const racing = 300
      const b = yield* connect(port)
      const writer = yield* Effect.forkChild(
        Effect.forEach(Array.from({ length: racing }, (_, i) => `New ${i}`), write, { concurrency: 8, discard: true }),
      )
      const received = yield* next(b["events.subscribe"]({ scope, afterSeq: 0 }), backlog + racing)
      yield* Fiber.join(writer)

      // Every event in this workspace, in order, once: seqs 1..N with no gap or repeat.
      expect(received.map((e) => e.seq)).toEqual(Array.from({ length: backlog + racing }, (_, i) => i + 1))
    }).pipe(Effect.scoped), 60_000)

  it.live("a label's group (CEL-52) travels: made with one, moved to another, B sees both; an unknown group is refused", () =>
    Effect.gen(function* () {
      const { port } = yield* startServer(yield* tempDataDir)
      const a = yield* connect(port)
      const { workspace, project } = yield* setup(a)
      const scope = { workspaceId: workspace.id }
      const b = yield* connect(port)
      const from = (yield* b["snapshot.get"]({ scope })).seq
      const received = yield* Effect.forkChild(next(b["events.subscribe"]({ scope, afterSeq: from }), 2))

      const { result: label } = yield* a["label.create"]({ commandId: newCommandId(), projectId: project.id, name: "bug", color: "#EF4444", group: "kind" })
      yield* a["label.update"]({ commandId: newCommandId(), id: label.id, group: "area" })
      const events = yield* Fiber.join(received)
      expect(events[0]).toMatchObject({ type: "label.created", label: { name: "bug", group: "kind" } })
      expect(events[1]).toMatchObject({ type: "label.updated", before: { group: "kind" }, after: { group: "area" } })
      expect((yield* b["snapshot.get"]({ scope })).labels.find((l) => l.id === label.id)?.group).toBe("area")

      const refused = yield* Effect.exit(a["label.update"]({ commandId: newCommandId(), id: label.id, group: "theme" as never }))
      expect(refused._tag).toBe("Failure")
      expect((yield* a["snapshot.get"]({ scope })).labels.find((l) => l.id === label.id)?.group).toBe("area")
    }).pipe(Effect.scoped))
})
