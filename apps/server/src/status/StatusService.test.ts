import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import { cmd } from "../testing/fixtures.ts"
import { asHuman, services } from "../testing/TestLayers.ts"
import * as StatusService from "./StatusService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

const statusNames = Effect.gen(function* () {
  const snapshot = yield* (yield* SnapshotService.SnapshotService).get()
  return { names: snapshot.statuses.map((s) => s.name), byName: Object.fromEntries(snapshot.statuses.map((s) => [s.name, s])) }
})

describe("StatusService.update", () => {
  it.effect("renames, recolors, hides and reorders, with only the changes in the event", () =>
    run(Effect.gen(function* () {
      const statuses = yield* StatusService.StatusService
      const { byName } = yield* statusNames
      const { result } = yield* statuses.update({
        commandId: cmd(),
        id: byName["In Review"]!.id,
        name: "Review",
        hidden: true,
        before: byName["Todo"]!.id,
        after: byName["In Progress"]!.id,
      })
      expect(result).toMatchObject({ name: "Review", hidden: true })
      expect((yield* statusNames).names).toEqual(["Backlog", "Todo", "Review", "In Progress", "Done", "Canceled"])
    })))

  it.effect("a name used by another status is Invalid; a no-op writes nothing", () =>
    run(Effect.gen(function* () {
      const statuses = yield* StatusService.StatusService
      const { byName } = yield* statusNames
      expect(yield* Effect.flip(statuses.update({ commandId: cmd(), id: byName["Todo"]!.id, name: "Done" }))).toMatchObject({
        _tag: "Invalid",
        field: "name",
      })
      expect((yield* statuses.update({ commandId: cmd(), id: byName["Todo"]!.id, name: "Todo" })).seq).toBeNull()
    })))
})
