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

  it.effect("a name that differs only in case is taken too, by a live label or an archived one", () =>
    run(Effect.gen(function* () {
      const labels = yield* LabelService.LabelService
      const workspaceId = (yield* (yield* SnapshotService.SnapshotService).get()).workspaces[0]!.id
      const { result: board } = yield* labels.create({ commandId: cmd(), workspaceId, name: "board", color: "#5B9A74" })
      expect(yield* Effect.flip(labels.create({ commandId: cmd(), workspaceId, name: " Board ", color: "#00FF00" }))).toEqual(
        expect.objectContaining({ _tag: "Invalid", field: "name", reason: `there's already a label named "board"` }),
      )
      const { result: ui } = yield* labels.create({ commandId: cmd(), workspaceId, name: "ui", color: "#3B82F6" })
      expect(yield* Effect.flip(labels.update({ commandId: cmd(), id: ui.id, name: "BOARD" }))).toMatchObject({
        reason: `there's already a label named "board"`,
      })
      yield* labels.archive({ commandId: cmd(), id: ui.id })
      expect(yield* Effect.flip(labels.create({ commandId: cmd(), workspaceId, name: "UI", color: "#3B82F6" }))).toMatchObject({
        reason: `there's already an archived label named "ui"`,
      })
      // Renaming a label to its own name in another case is fine.
      const { result: renamed } = yield* labels.update({ commandId: cmd(), id: board.id, name: "Board" })
      expect(renamed.name).toBe("Board")
    })))

  it.effect("a label has a group (CEL-52): none unless given, set at create or by update, one event per change", () =>
    run(Effect.gen(function* () {
      const labels = yield* LabelService.LabelService
      const snapshots = yield* SnapshotService.SnapshotService
      const workspaceId = (yield* snapshots.get()).workspaces[0]!.id
      const { result: misc } = yield* labels.create({ commandId: cmd(), workspaceId, name: "misc", color: "#999999" })
      expect(misc.group).toBe("none")
      const { result: bug, seq: created } = yield* labels.create({ commandId: cmd(), workspaceId, name: "bug", color: "#EF4444", group: "kind" })
      expect(bug.group).toBe("kind")

      const moved = yield* labels.update({ commandId: cmd(), id: misc.id, group: "area" })
      expect(moved.result.group).toBe("area")
      expect(moved.seq).toBeGreaterThan(created!)
      // Already in that group: nothing to write.
      const again = yield* labels.update({ commandId: cmd(), id: misc.id, group: "area" })
      expect(again.seq).toBeNull()

      const snapshot = yield* snapshots.get()
      expect(snapshot.labels.find((l) => l.id === misc.id)?.group).toBe("area")
      expect(snapshot.labels.find((l) => l.id === bug.id)?.group).toBe("kind")
    })))
})
