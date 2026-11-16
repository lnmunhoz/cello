// Labels belong to a project (CEL-80), not the workspace: each project has its own kinds, areas and
// milestones, so ThaiLookup's areas no longer show in Cello's pickers.
//
// - `labels` gains `project_id` (required) and its names become unique per project, ignoring case,
//   archived labels included (they were unique per workspace). SQLite can't change a UNIQUE in place,
//   so the table is rebuilt under the task_labels that reference it, the way 0006 rebuilt `statuses`:
//   its rows are copied out, the table is dropped and made again, and the rows go back with every
//   column as it was plus the project. All migrations run in one transaction, where foreign keys can't
//   be switched off, so they're deferred to the commit: if any task_labels row were left without its
//   label, the commit would fail and nothing would change.
// - Which project a label goes to:
//   - a label on tasks of one project goes to that project
//   - a label on tasks of several projects stays with the one with the most tasks carrying it (archived
//     tasks count; a tie goes to the oldest project). Every other project gets a copy (same name,
//     colour, group, timestamps and archived_at, a new id) and its tasks are moved onto the copy, so
//     each task keeps the same label names
//   - a label on no task goes to the project made last at or before the label (it came with that
//     project, e.g. ThaiLookup's import); one older than every project goes to the oldest
//   - a label in a workspace with no project at all is dropped: no task can carry it
// - No events are written, as in 0009: a migration changes the stored rows, and the web app reloads
//   with the new build. `label.created` events stored before carry no project; the contract reads them
//   with an empty one.
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import { newId } from "../ids.ts"

const OLD_COLUMNS = "id, workspace_id, name, color, label_group, created_at, updated_at, archived_at"

interface OldLabel {
  readonly id: string
  readonly workspace_id: string
  readonly name: string
  readonly color: string
  readonly label_group: string
  readonly created_at: number
  readonly updated_at: number
  readonly archived_at: number | null
}

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const labels = yield* sql.unsafe<OldLabel>(`SELECT ${OLD_COLUMNS} FROM labels ORDER BY rowid`)
  const projects = yield* sql<{ id: string; workspace_id: string; created_at: number }>`
    SELECT id, workspace_id, created_at FROM projects ORDER BY created_at, id`
  const usage = yield* sql<{ label_id: string; project_id: string; tasks: number }>`
    SELECT tl.label_id, t.project_id, COUNT(*) AS tasks FROM task_labels tl JOIN tasks t ON t.id = tl.task_id
    GROUP BY tl.label_id, t.project_id`

  const age = new Map(projects.map((p, i) => [p.id, i]))
  /** For each label, the projects whose tasks carry it, most tasks first, then oldest. */
  const usedBy = (labelId: string) =>
    usage
      .filter((u) => u.label_id === labelId)
      .sort((a, b) => Number(b.tasks) - Number(a.tasks) || age.get(a.project_id)! - age.get(b.project_id)!)
      .map((u) => u.project_id)
  /** The project an unused label came with: the latest made at or before it, else the oldest. */
  const madeWith = (label: OldLabel) => {
    const inWorkspace = projects.filter((p) => p.workspace_id === label.workspace_id)
    return inWorkspace.filter((p) => p.created_at <= label.created_at).at(-1)?.id ?? inWorkspace[0]?.id
  }

  yield* sql`PRAGMA defer_foreign_keys = ON`
  yield* sql.unsafe(`CREATE TABLE labels_before_projects AS SELECT ${OLD_COLUMNS} FROM labels`)
  yield* sql`DROP TABLE labels`
  yield* sql`CREATE TABLE labels (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    color TEXT NOT NULL,
    label_group TEXT NOT NULL DEFAULT 'none',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    archived_at INTEGER
  )`
  yield* sql`CREATE UNIQUE INDEX labels_project_name ON labels (project_id, lower(name))`

  const insert = (label: OldLabel, id: string, projectId: string) =>
    sql`INSERT INTO labels (id, workspace_id, project_id, name, color, label_group, created_at, updated_at, archived_at)
      VALUES (${id}, ${label.workspace_id}, ${projectId}, ${label.name}, ${label.color}, ${label.label_group},
              ${label.created_at}, ${label.updated_at}, ${label.archived_at})`

  let kept = 0
  let dropped = 0
  for (const label of labels) {
    const [owner, ...others] = usedBy(label.id)
    const projectId = owner ?? madeWith(label)
    if (projectId === undefined) {
      dropped++
      continue
    }
    yield* insert(label, label.id, projectId)
    kept++
    for (const other of others) {
      const copy = newId(label.created_at)
      yield* insert(label, copy, other)
      yield* sql`UPDATE task_labels SET label_id = ${copy}
        WHERE label_id = ${label.id} AND task_id IN (SELECT id FROM tasks WHERE project_id = ${other})`
    }
  }
  if (kept + dropped !== labels.length) return yield* Effect.die(new Error(`labels: put back ${kept} + ${dropped} of ${labels.length} rows`))
  yield* sql`DROP TABLE labels_before_projects`
})
