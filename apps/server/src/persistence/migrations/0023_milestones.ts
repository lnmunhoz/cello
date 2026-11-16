// Milestones (CEL-113): a project's goals, each task in at most one. They replace the Milestone labels
// (CEL-52's group), which could filter the board but had no date, order or progress.
//
// - A `milestones` table, names unique per project ignoring case, and a nullable `tasks.milestone_id`.
// - Each label in the Milestone group becomes a milestone of the same name (trimmed) in its project,
//   ordered by name with numbers by value (M2 before M10), keeping the label's times. An archived label
//   becomes a closed milestone, closed when it was archived. Two labels whose names match once trimmed
//   and ignoring case ("M3", "M3 ") make one milestone.
// - Each task carrying such labels goes to the milestone of the latest of them in that order: a task with
//   M2 and M3 gets M3. Archived tasks too, so a milestone keeps all its history.
//   Only its own project's labels count: a stray link to another project's label is dropped with it.
// - Then the Milestone labels are removed, from the tasks and from the project (Lucas: one way to say
//   "milestone"). Other labels stay as they were.
// - Unlike earlier migrations this one writes events, as the human: each milestone's `milestone.created`,
//   and on each task a `task.milestone_changed` naming the labels it carried (`fromLabels`, the one it
//   got first), so its history says what became of a second label. That task's version goes up by one
//   to match; nothing else about it changes (not its last change: the migration isn't an edit of anyone's).
// A board with no Milestone labels only gets the table and the column.
import { compareMilestoneNames } from "@cello/shared/milestone"
import { positionsAfter } from "@cello/shared/position"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import { newId } from "../ids.ts"

interface LabelRow {
  readonly id: string
  readonly workspace_id: string
  readonly project_id: string
  readonly name: string
  readonly created_at: number
  readonly updated_at: number
  readonly archived_at: number | null
}

const COMMAND_ID = "migration:0023_milestones"

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE milestones (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id),
    name TEXT NOT NULL,
    goal TEXT NOT NULL DEFAULT '',
    target_date TEXT,
    position TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed')),
    closed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`
  yield* sql`CREATE UNIQUE INDEX milestones_project_name ON milestones (project_id, lower(name))`
  yield* sql`ALTER TABLE tasks ADD COLUMN milestone_id TEXT REFERENCES milestones(id)`
  yield* sql`CREATE INDEX tasks_milestone ON tasks (milestone_id)`

  const labels = yield* sql<LabelRow>`
    SELECT id, workspace_id, project_id, name, created_at, updated_at, archived_at FROM labels WHERE label_group = 'milestone'`
  if (labels.length === 0) return

  const now = yield* Clock.currentTimeMillis
  const [actor] = yield* sql<{ id: string }>`SELECT id FROM actors ORDER BY kind = 'human' DESC, created_at LIMIT 1`
  const emit = (type: string, entity: { type: string; id: string }, where: { workspaceId: string; projectId: string }, payload: object) =>
    actor === undefined
      ? Effect.void
      : sql`INSERT INTO events (ts, type, entity_type, entity_id, workspace_id, project_id, command_id, actor_id, session_id,
                                schema_version, payload, created_at)
          VALUES (${now}, ${type}, ${entity.type}, ${entity.id}, ${where.workspaceId}, ${where.projectId}, ${COMMAND_ID},
                  ${actor.id}, NULL, 1, ${JSON.stringify(payload)}, ${now})`

  /** Label order: by name, numbers by value; a label's rank is its place in it. */
  const ordered = [...labels].sort((a, b) => compareMilestoneNames(a.name.trim(), b.name.trim()) || compareMilestoneNames(a.name, b.name) || (a.id < b.id ? -1 : 1))
  const rank = new Map(ordered.map((l, i) => [l.id, i]))
  /** Each label's milestone. */
  const milestoneOf = new Map<string, string>()

  for (const projectId of [...new Set(ordered.map((l) => l.project_id))]) {
    const inProject = ordered.filter((l) => l.project_id === projectId)
    const byName = new Map<string, LabelRow[]>()
    for (const label of inProject) {
      const key = label.name.trim().toLowerCase()
      byName.set(key, [...(byName.get(key) ?? []), label])
    }
    const groups = [...byName.values()]
    const positions = positionsAfter(null, groups.length)
    for (const [i, group] of groups.entries()) {
      const first = group[0]!
      // Closed only when every label of the name was archived; then when the last of them was.
      const closedAt = group.every((l) => l.archived_at !== null) ? Math.max(...group.map((l) => l.archived_at!)) : null
      const milestone = {
        id: newId(first.created_at),
        projectId,
        name: first.name.trim(),
        goal: "",
        targetDate: null,
        position: positions[i]!,
        state: closedAt === null ? "open" : "closed",
        closedAt,
        createdAt: Math.min(...group.map((l) => l.created_at)),
        updatedAt: Math.max(...group.map((l) => l.updated_at)),
      }
      yield* sql`INSERT INTO milestones (id, project_id, name, goal, target_date, position, state, closed_at, created_at, updated_at)
        VALUES (${milestone.id}, ${projectId}, ${milestone.name}, '', NULL, ${milestone.position}, ${milestone.state},
                ${milestone.closedAt}, ${milestone.createdAt}, ${milestone.updatedAt})`
      yield* emit("milestone.created", { type: "milestone", id: milestone.id }, { workspaceId: first.workspace_id, projectId }, { milestone })
      for (const label of group) milestoneOf.set(label.id, milestone.id)
    }
  }

  const links = yield* sql<{ task_id: string; label_id: string; version: number; workspace_id: string; project_id: string }>`
    SELECT tl.task_id, tl.label_id, t.version, p.workspace_id, t.project_id
    FROM task_labels tl JOIN tasks t ON t.id = tl.task_id JOIN projects p ON p.id = t.project_id
      JOIN labels l ON l.id = tl.label_id
    WHERE tl.label_id IN ${sql.in(labels.map((l) => l.id))}
      -- A task only ever gets its own project's milestone, even from a stray link to another project's label.
      AND l.project_id = t.project_id
    ORDER BY t.project_id, t.number`
  const name = new Map(labels.map((l) => [l.id, l.name]))
  for (const taskId of [...new Set(links.map((l) => l.task_id))]) {
    const carried = links.filter((l) => l.task_id === taskId).sort((a, b) => rank.get(b.label_id)! - rank.get(a.label_id)!)
    const chosen = carried[0]!
    const milestoneId = milestoneOf.get(chosen.label_id)!
    const version = chosen.version + 1
    yield* sql`UPDATE tasks SET milestone_id = ${milestoneId}, version = ${version} WHERE id = ${taskId}`
    yield* emit("task.milestone_changed", { type: "task", id: taskId }, { workspaceId: chosen.workspace_id, projectId: chosen.project_id }, {
      id: taskId,
      version,
      before: null,
      after: milestoneId,
      fromLabels: carried.map((l) => name.get(l.label_id)!),
    })
  }

  yield* sql`DELETE FROM task_labels WHERE label_id IN ${sql.in(labels.map((l) => l.id))}`
  yield* sql`DELETE FROM labels WHERE id IN ${sql.in(labels.map((l) => l.id))}`
})
