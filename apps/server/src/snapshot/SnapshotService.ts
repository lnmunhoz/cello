// Everything a board needs at once, read in one transaction so rows and `seq` agree.
import type { Scope, Snapshot } from "@cello/contract/entities"
import { NotFound } from "@cello/contract/errors"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import type * as Statement from "effect/sql/Statement"
import { AgentService } from "../session/AgentService.ts"
import { SessionService } from "../session/SessionService.ts"
import { wakeOf } from "@cello/contract/wake"
import * as EventStore from "../events/EventStore.ts"
import {
  selectActors,
  selectAsks,
  selectDocuments,
  selectLabels,
  selectMilestones,
  selectProjects,
  selectReviews,
  selectStatuses,
  selectTasks,
  selectWorkspaces,
} from "../persistence/rows.ts"

export class SnapshotService extends Context.Service<SnapshotService, {
  /**
   * The board for a workspace or a project; with no scope, the first non-archived workspace by
   * position. `workspaces` always lists every non-archived workspace, for the switcher. Archived
   * projects, labels and tasks are included so later events (e.g. task.unarchived) have rows to apply to.
   */
  readonly get: (scope?: Scope) => Effect.Effect<Snapshot, NotFound>
}>()("cello/SnapshotService") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const store = yield* EventStore.EventStore
  const sessions = yield* SessionService
  const agents = yield* AgentService

  const get = Effect.fn("SnapshotService.get")(function* (scope?: Scope) {
    return yield* sql.withTransaction(Effect.gen(function* () {
      const workspaces = yield* selectWorkspaces(sql, sql`w.archived_at IS NULL`)
      let workspaceId: string
      let projectFilter: Statement.Fragment
      if (scope === undefined) {
        const first = workspaces[0]
        if (!first) return yield* new NotFound({ entity: "workspace", id: "" })
        workspaceId = first.id
        projectFilter = sql`p.workspace_id = ${workspaceId}`
      } else if ("workspaceId" in scope) {
        const found = yield* sql<{ id: string }>`SELECT id FROM workspaces WHERE id = ${scope.workspaceId}`
        if (!found[0]) return yield* new NotFound({ entity: "workspace", id: scope.workspaceId })
        workspaceId = scope.workspaceId
        projectFilter = sql`p.workspace_id = ${workspaceId}`
      } else {
        const found = yield* sql<{ workspace_id: string }>`SELECT workspace_id FROM projects WHERE id = ${scope.projectId}`
        if (!found[0]) return yield* new NotFound({ entity: "project", id: scope.projectId })
        workspaceId = found[0].workspace_id
        projectFilter = sql`p.id = ${scope.projectId}`
      }
      const tasks = yield* selectTasks(sql, projectFilter)
      // The last holder (CEL-110) too: the comment box names who a comment on a task nobody holds reopens it for.
      const sessionIds = tasks.flatMap((t) => [t.createdBySessionId, t.assigneeSessionId, t.lastHolderSessionId ?? null, t.updatedBySessionId].filter((id) => id !== null))
      // Subagents (CEL-55): the ones on these tasks, the ones that changed them last, and the live ones
      // of their sessions; their sessions come along, so a card can name the parent.
      const onBoard = yield* agents.forBoard(tasks.map((t) => t.id), sessionIds)
      const lastChanged = yield* agents.byRefs(tasks.flatMap((t) =>
        t.updatedBySessionId !== null && t.updatedByAgentId ? [{ sessionId: t.updatedBySessionId, agentId: t.updatedByAgentId }] : []))
      const boardAgents = [...onBoard, ...lastChanged.filter((a) => !onBoard.some((b) => b.sessionId === a.sessionId && b.agentId === a.agentId))]
      return {
        seq: yield* store.latestSeq,
        actors: yield* selectActors(sql),
        workspaces,
        projects: yield* selectProjects(sql, projectFilter),
        statuses: yield* selectStatuses(sql, sql`s.workspace_id = ${workspaceId}`),
        // Labels belong to a project (CEL-80): a workspace's snapshot has every project's, a project's its own.
        labels: yield* selectLabels(sql, sql`l.project_id IN (SELECT p.id FROM projects p WHERE ${projectFilter})`),
        // Milestones (CEL-113), closed ones too: a task may still be in one.
        milestones: yield* selectMilestones(sql, sql`m.project_id IN (SELECT p.id FROM projects p WHERE ${projectFilter})`),
        tasks,
        sessions: yield* sessions.byIds([...sessionIds, ...boardAgents.map((a) => a.sessionId)]),
        agents: boardAgents,
        reviews: yield* selectReviews(sql, sql`r.decided_at IS NULL AND ${projectFilter}`),
        asks: yield* selectAsks(sql, sql`a.state = 'open' AND ${projectFilter}`),
        // The latest wake of each task (CEL-92), for its Working on it row.
        wakes: (yield* store.latestWakes(tasks.map((t) => t.id))).flatMap((e) => wakeOf(e) ?? []),
        documents: yield* selectDocuments(sql, projectFilter),
      } satisfies Snapshot
    }))
  }, Effect.catchTag("SqlError", Effect.die))

  return SnapshotService.of({ get })
})

export const layer = Layer.effect(SnapshotService, make)
