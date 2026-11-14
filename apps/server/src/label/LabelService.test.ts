import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import { cmd } from "../testing/fixtures.ts"
import { asHuman, services } from "../testing/TestLayers.ts"
import * as LabelService from "./LabelService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

describe("LabelService", () => {
  it.effect("create, rename, recolor and archive; names are unique in the workspace", () =>
    run(Effect.gen(function* () {
      const labels = yield* LabelService.LabelService
      const workspaceId = (yield* (yield* SnapshotService.SnapshotService).get()).workspaces[0]!.id
      const { result: bug } = yield* labels.create({ commandId: cmd(), workspaceId, name: " Bug ", color: "#ff0000" })
      expect(bug).toMatchObject({ name: "Bug", color: "#FF0000", archivedAt: null })
      expect(yield* Effect.flip(labels.create({ commandId: cmd(), workspaceId, name: "Bug", color: "#00FF00" }))).toMatchObject({
        _tag: "Invalid",
        field: "name",
      })
      const { result: renamed } = yield* labels.update({ commandId: cmd(), id: bug.id, name: "Defect", color: "#00FF00" })
      expect(renamed).toMatchObject({ name: "Defect", color: "#00FF00" })
      const { result: archived } = yield* labels.archive({ commandId: cmd(), id: bug.id })
      expect(archived.archivedAt).not.toBeNull()
      expect(yield* Effect.flip(labels.archive({ commandId: cmd(), id: "nope" }))).toMatchObject({ _tag: "NotFound" })
    })))
})
