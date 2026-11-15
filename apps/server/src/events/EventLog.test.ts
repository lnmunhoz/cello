import type { CelloEvent } from "@cello/contract/events"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Deferred from "effect/Deferred"
import * as Fiber from "effect/Fiber"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import { Caller } from "@cello/contract/rpcs"
import * as Commands from "../commands/Commands.ts"
import * as Seed from "../persistence/Seed.ts"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import * as LabelService from "../label/LabelService.ts"
import * as ProjectService from "../project/ProjectService.ts"
import * as RepoPaths from "../project/repoPath.ts"
import * as SessionService from "../session/SessionService.ts"
import * as AgentService from "../session/AgentService.ts"
import * as TaskService from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asHuman, database, services } from "../testing/TestLayers.ts"
import * as EventLog from "./EventLog.ts"
import * as EventStore from "./EventStore.ts"
import * as InboxService from "../inbox/InboxService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

const collect = (stream: Stream.Stream<CelloEvent, unknown>, n: number) =>
  stream.pipe(Stream.take(n), Stream.runCollect, Effect.map((events) => events.map((e) => [e.seq, e.type] as const)))

describe("EventLog.subscribe", () => {
  it.effect("replays stored events after afterSeq, then delivers live ones, without gaps or repeats", () =>
    run(Effect.gen(function* () {
      const log = yield* EventLog.EventLog
      const tasks = yield* TaskService.TaskService
      const { workspace, project } = yield* setupProject
      const { seq: afterSeq } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Seen" })
      const { seq: missed } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Missed" })

      const fiber = yield* Effect.forkChild(collect(log.subscribe({ workspaceId: workspace.id }, afterSeq!), 3))
      const { seq: live1 } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Live 1" })
      const { seq: live2 } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Live 2" })
      expect(yield* Fiber.join(fiber)).toEqual([
        [missed, "task.created"],
        [live1, "task.created"],
        [live2, "task.created"],
      ])
    })))

  it.effect("a project scope skips other projects but keeps workspace-level events", () =>
    run(Effect.gen(function* () {
      const log = yield* EventLog.EventLog
      const tasks = yield* TaskService.TaskService
      const { workspace, project } = yield* setupProject
      const { result: other } = yield* (yield* ProjectService.ProjectService).create({
        commandId: cmd(),
        workspaceId: workspace.id,
        name: "Other",
        key: "OTH",
      })
      const fiber = yield* Effect.forkChild(collect(log.subscribe({ projectId: project.id }, 0), 3))
      yield* tasks.create({ commandId: cmd(), projectId: other.id, title: "Not mine" })
      yield* (yield* LabelService.LabelService).create({ commandId: cmd(), workspaceId: workspace.id, name: "Bug", color: "#FF0000" })
      yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Mine" })
      const types = (yield* Fiber.join(fiber)).map(([, type]) => type)
      expect(types).toEqual(["project.created", "label.created", "task.created"])
    })))

  it.effect("a client ahead of the server (a different database) must take a snapshot", () =>
    run(Effect.gen(function* () {
      const log = yield* EventLog.EventLog
      const { workspace } = yield* setupProject
      const error = yield* log.subscribe({ workspaceId: workspace.id }, 999).pipe(Stream.runCollect, Effect.flip)
      expect(error).toMatchObject({ _tag: "SnapshotRequired", latestSeq: 1 })
    })))
})

/**
 * The real EventStore, with a hook that runs a commit right before or right after the subscriber
 * reads the table: the two moments a commit can race the replay.
 */
const race = { before: Effect.void as Effect.Effect<void>, after: Effect.void as Effect.Effect<void> }
const racingStore = Layer.effect(EventStore.EventStore, Effect.gen(function* () {
  const real = yield* EventStore.EventStore
  return EventStore.EventStore.of({
    ...real,
    readAfter: (scope, afterSeq) =>
      Effect.gen(function* () {
        yield* race.before
        const rows = yield* real.readAfter(scope, afterSeq)
        yield* race.after
        return rows
      }),
  })
})).pipe(Layer.provide(EventStore.layer))

const racingServices = () =>
  Layer.mergeAll(TaskService.layer, ProjectService.layer, SnapshotService.layer).pipe(
    Layer.provideMerge(InboxService.layer),
    Layer.provideMerge(SessionService.layer),
    Layer.provideMerge(AgentService.layer),
    Layer.provideMerge(RepoPaths.layer),
    Layer.provideMerge(Commands.layer),
    Layer.provideMerge(EventLog.layer),
    Layer.provideMerge(racingStore),
    Layer.provideMerge(database()),
  )

describe("EventLog.subscribe racing commits", () => {
  for (const moment of ["before", "after"] as const) {
    it.effect(`a commit landing just ${moment} the replay read arrives exactly once`, () =>
      Effect.gen(function* () {
        const log = yield* EventLog.EventLog
        const tasks = yield* TaskService.TaskService
        const human = yield* Seed.HumanActor
        const { workspace, project } = yield* setupProject
        const create = (title: string) =>
          tasks.create({ commandId: cmd(), projectId: project.id, title }).pipe(
            Effect.provideService(Caller, { actorId: human.id, sessionId: null }),
            Effect.orDie,
          )
        yield* create("Stored")

        // "Final" is written only once the replay read is done, so it can only arrive live.
        const readDone = yield* Deferred.make<void>()
        race[moment] = create("Racing").pipe(Effect.ensuring(Effect.sync(() => { race[moment] = Effect.void })))
        const after = race.after
        race.after = after.pipe(
          Effect.andThen(Deferred.succeed(readDone, undefined)),
          Effect.ensuring(Effect.sync(() => { race.after = Effect.void })),
        )
        const fiber = yield* Effect.forkChild(
          log.subscribe({ workspaceId: workspace.id }, 0).pipe(
            Stream.takeUntil((e) => e.type === "task.created" && e.task.title === "Final"),
            Stream.runCollect,
          ),
        )
        yield* Deferred.await(readDone)
        yield* create("Final")

        const titles = (yield* Fiber.join(fiber)).map((e) => (e.type === "task.created" ? e.task.title : e.type))
        expect(titles).toEqual(["project.created", "Stored", "Racing", "Final"])
      }).pipe(asHuman, Effect.provide(racingServices())))
  }
})
