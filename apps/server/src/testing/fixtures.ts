// Small builders for service tests: the seeded workspace and a project in it.
import * as Effect from "effect/Effect"
import * as ProjectService from "../project/ProjectService.ts"
import * as SnapshotService from "../snapshot/SnapshotService.ts"

let counter = 0
/** A fresh command id. */
export const cmd = (): string => `cmd-${++counter}`

/** The seeded workspace, its statuses by name, and a new project "Cello" (key CEL) in it. */
export const setupProject = Effect.gen(function* () {
  const snapshot = yield* (yield* SnapshotService.SnapshotService).get()
  const workspace = snapshot.workspaces[0]!
  const status = Object.fromEntries(snapshot.statuses.map((s) => [s.name, s]))
  const { result: project } = yield* (yield* ProjectService.ProjectService).create({
    commandId: cmd(),
    workspaceId: workspace.id,
    name: "Cello",
    key: "CEL",
  })
  return { workspace, status, project }
})
