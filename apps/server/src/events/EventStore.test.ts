// The events table's reads. `recent` is what `cello context` shows as Recent activity.
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { database } from "../testing/TestLayers.ts"
import * as EventStore from "./EventStore.ts"

const context = (commandId: string, ts: number): EventStore.EventContext => ({
  ts, commandId, actorId: "human", sessionId: null, agentId: null, model: null, effort: null, workspaceId: "w", projectId: "p",
})

describe("tests.finished (CEL-181)", () => {
  const run = { label: "unit tests", command: "bun run test", startedAt: 1, endedAt: 9, outcome: "failed" as const, background: false, progress: null }

  it.effect("belongs to its task's history as entity `tests`, and stays out of Recent activity", () =>
    Effect.gen(function* () {
      const store = yield* EventStore.EventStore
      expect(EventStore.entityOf({ type: "tests.finished", taskId: "t1", run })).toEqual({ type: "tests", id: "t1" })
      yield* store.append({ type: "task.archived", id: "t1", version: 2 }, context("cmd-1", 1))
      yield* store.append({ type: "tests.finished", taskId: "t1", run }, context("cmd-2", 2))
      expect((yield* store.history("t1")).map((e) => e.type)).toEqual(["task.archived", "tests.finished"])
      expect((yield* store.recent("p", 10)).map((e) => e.type)).toEqual(["task.archived"])
    }).pipe(Effect.provide(EventStore.layer.pipe(Layer.provideMerge(database())))))
})

describe("EventStore.recent", () => {
  it.effect("leaves out the events a migration wrote (CEL-113), so they don't fill Recent activity right after a deploy", () =>
    Effect.gen(function* () {
      const store = yield* EventStore.EventStore
      yield* store.append({ type: "task.milestone_changed", id: "t1", version: 2, before: null, after: "m3", fromLabels: ["M3"] }, context(`${EventStore.MIGRATION_COMMAND_PREFIX}0024_milestones`, 1))
      yield* store.append({ type: "task.milestone_changed", id: "t2", version: 2, before: null, after: "m3" }, context("cmd-1", 2))
      yield* store.append({ type: "task.archived", id: "t3", version: 2 }, context("cmd-2", 3))
      const recent = yield* store.recent("p", 10)
      expect(recent.map((e) => e.commandId)).toEqual(["cmd-2", "cmd-1"])
      // The task's own history keeps it.
      expect((yield* store.history("t1")).map((e) => e.type)).toEqual(["task.milestone_changed"])
    }).pipe(Effect.provide(EventStore.layer.pipe(Layer.provideMerge(database())))))
})
