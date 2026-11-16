import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import * as EventStore from "../events/EventStore.ts"
import * as ProjectService from "../project/ProjectService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asHuman, services } from "../testing/TestLayers.ts"
import * as LabelService from "./LabelService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services())) as Effect.Effect<A, E>

describe("LabelService", () => {
  it.effect("create, rename, recolor and archive; names are unique in the project", () =>
    run(Effect.gen(function* () {
      const labels = yield* LabelService.LabelService
      const projectId = (yield* setupProject).project.id
      const { result: bug } = yield* labels.create({ commandId: cmd(), projectId, name: " Bug ", color: "#ff0000" })
      expect(bug).toMatchObject({ name: "Bug", color: "#FF0000", archivedAt: null })
      expect(yield* Effect.flip(labels.create({ commandId: cmd(), projectId, name: "Bug", color: "#00FF00" }))).toMatchObject({
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
      const projectId = (yield* setupProject).project.id
      const { result: board } = yield* labels.create({ commandId: cmd(), projectId, name: "board", color: "#5B9A74" })
      expect(yield* Effect.flip(labels.create({ commandId: cmd(), projectId, name: " Board ", color: "#00FF00" }))).toEqual(
        expect.objectContaining({ _tag: "Invalid", field: "name", reason: `there's already a label named "board"` }),
      )
      const { result: ui } = yield* labels.create({ commandId: cmd(), projectId, name: "ui", color: "#3B82F6" })
      expect(yield* Effect.flip(labels.update({ commandId: cmd(), id: ui.id, name: "BOARD" }))).toMatchObject({
        reason: `there's already a label named "board"`,
      })
      yield* labels.archive({ commandId: cmd(), id: ui.id })
      expect(yield* Effect.flip(labels.create({ commandId: cmd(), projectId, name: "UI", color: "#3B82F6" }))).toMatchObject({
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
      const projectId = (yield* setupProject).project.id
      const { result: misc } = yield* labels.create({ commandId: cmd(), projectId, name: "misc", color: "#999999" })
      expect(misc.group).toBe("none")
      const { result: bug, seq: created } = yield* labels.create({ commandId: cmd(), projectId, name: "bug", color: "#EF4444", group: "kind" })
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

  it.effect("a label belongs to its project (CEL-80): another project may use the same name, and its events go to that project", () =>
    run(Effect.gen(function* () {
      const labels = yield* LabelService.LabelService
      const store = yield* EventStore.EventStore
      const { workspace, project: cel } = yield* setupProject
      const { result: thai } = yield* (yield* ProjectService.ProjectService).create({ commandId: cmd(), workspaceId: workspace.id, name: "ThaiLookup", key: "THAI" })
      const { result: celBug, seq } = yield* labels.create({ commandId: cmd(), projectId: cel.id, name: "bug", color: "#EF4444", group: "kind" })
      expect(celBug).toMatchObject({ projectId: cel.id, workspaceId: workspace.id })
      const { result: thaiBug } = yield* labels.create({ commandId: cmd(), projectId: thai.id, name: "Bug", color: "#EF4444", group: "kind" })
      expect(thaiBug).toMatchObject({ projectId: thai.id, name: "Bug" })
      expect(thaiBug.id).not.toBe(celBug.id)
      // Renaming within THAI checks THAI's names only.
      const { result: thaiDecks } = yield* labels.create({ commandId: cmd(), projectId: thai.id, name: "decks", color: "#8D7B68" })
      expect(yield* Effect.flip(labels.update({ commandId: cmd(), id: thaiDecks.id, name: "bug" }))).toMatchObject({ _tag: "Invalid", field: "name" })
      yield* labels.update({ commandId: cmd(), id: celBug.id, name: "decks" })
      yield* labels.archive({ commandId: cmd(), id: thaiDecks.id })

      // Every label event is the project's, so a project subscription gets its own and not the other's.
      const celEvents = yield* store.readAfter({ workspaceId: workspace.id, projectId: cel.id }, seq! - 1)
      const thaiEvents = yield* store.readAfter({ workspaceId: workspace.id, projectId: thai.id }, seq! - 1)
      const labelEvents = (events: ReadonlyArray<{ type: string; projectId: string | null }>) =>
        events.filter((e) => e.type.startsWith("label.")).map((e) => `${e.type} ${e.projectId}`)
      expect(labelEvents(celEvents)).toEqual([`label.created ${cel.id}`, `label.updated ${cel.id}`])
      expect(labelEvents(thaiEvents)).toEqual([`label.created ${thai.id}`, `label.created ${thai.id}`, `label.archived ${thai.id}`])

      // A project's snapshot has its own labels; the workspace's has every project's.
      const snapshots = yield* SnapshotService.SnapshotService
      expect((yield* snapshots.get({ projectId: thai.id })).labels.map((l) => l.id)).toEqual([thaiBug.id, thaiDecks.id])
      expect((yield* snapshots.get({ workspaceId: workspace.id })).labels.map((l) => l.id).sort()).toEqual([celBug.id, thaiBug.id, thaiDecks.id].sort())

      expect(yield* Effect.flip(labels.create({ commandId: cmd(), projectId: "nope", name: "x", color: "#999999" }))).toMatchObject({
        _tag: "NotFound",
        entity: "project",
      })
    })))
})
