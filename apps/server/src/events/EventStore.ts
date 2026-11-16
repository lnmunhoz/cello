// The events table. `append` runs inside the caller's transaction; reads decode stored rows
// through the contract's `decodeEvent`, so an unreadable row is a defect.
import type { Scope } from "@cello/contract/entities"
import { CURRENT_SCHEMA_VERSION, decodeEvent, type CelloEvent, type EventBody } from "@cello/contract/events"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import { WAKE_EVENTS } from "@cello/contract/wake"
import type { ResolvedScope } from "./scope.ts"

/** Where an event belongs and who caused it: everything in the envelope except `seq`. */
export interface EventContext {
  readonly ts: number
  readonly commandId: string
  readonly actorId: string
  readonly sessionId: string | null
  /** The session's subagent that caused it (CEL-55), or null. */
  readonly agentId: string | null
  /** The model and effort the agent was on (CEL-119), or null when unknown (and for the human). */
  readonly model: string | null
  readonly effort: string | null
  readonly workspaceId: string
  readonly projectId: string | null
}

interface EventRow {
  seq: number
  ts: number
  type: string
  workspace_id: string
  project_id: string | null
  command_id: string
  actor_id: string
  session_id: string | null
  agent_id: string | null
  model: string | null
  effort: string | null
  schema_version: number
  payload: string
}

/** The entity an event is about: the `type` prefix, and the id from the payload. */
export const entityOf = (body: EventBody): { readonly type: string; readonly id: string } => {
  const type = body.type.slice(0, body.type.indexOf("."))
  switch (body.type) {
    case "workspace.created":
      return { type, id: body.workspace.id }
    case "project.created":
      return { type, id: body.project.id }
    case "label.created":
      return { type, id: body.label.id }
    case "milestone.created":
      return { type, id: body.milestone.id }
    case "task.created":
      return { type, id: body.task.id }
    case "comment.added":
      return { type, id: body.comment.id }
    case "comment.delivered":
      return { type, id: body.commentId }
    case "session.waiting":
    case "session.orchestrating":
      return { type, id: body.session }
    case "reaction.added":
    case "reaction.removed":
      return { type, id: body.reaction.id }
    case "review.submitted":
      return { type, id: body.review.id }
    case "ask.created":
    case "ask.answered":
      return { type, id: body.ask.id }
    case "document.published":
      return { type, id: body.document.id }
    case "session.seen":
      return { type, id: body.session.id }
    case "agent.seen":
      return { type, id: `${body.agent.sessionId}/${body.agent.agentId}` }
    case "build.recorded":
      return { type, id: body.build.id }
    case "profile.changed":
      return { type, id: body.project }
    // A wake is part of its task's history (CEL-92).
    case "session.wake_scheduled":
    case "session.not_woken":
      return { type, id: body.taskId }
    case "session.run_started":
    case "session.run_ended":
      return { type, id: body.run.taskId ?? body.run.id }
    case "wake.settings_changed":
      return { type, id: body.project }
    default:
      return { type, id: body.id }
  }
}

const decodeRow = (row: EventRow): CelloEvent =>
  decodeEvent({
    ...JSON.parse(row.payload),
    seq: row.seq,
    ts: row.ts,
    type: row.type,
    commandId: row.command_id,
    actorId: row.actor_id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    model: row.model,
    effort: row.effort,
    workspaceId: row.workspace_id,
    projectId: row.project_id,
    schemaVersion: row.schema_version,
  })

export class EventStore extends Context.Service<EventStore, {
  /** Appends one event. Call inside the transaction that makes the change. */
  readonly append: (body: EventBody, context: EventContext) => Effect.Effect<CelloEvent, SqlError>
  /** Every event about one entity, oldest first. */
  readonly history: (entityId: string) => Effect.Effect<ReadonlyArray<CelloEvent>>
  /** Looks up a project's workspace. A missing workspace or project resolves to an empty scope. */
  readonly resolveScope: (scope: Scope) => Effect.Effect<ResolvedScope>
  /** Events in scope after `afterSeq`, oldest first. */
  readonly readAfter: (scope: ResolvedScope, afterSeq: number) => Effect.Effect<ReadonlyArray<CelloEvent>>
  /** How many events in scope come after `afterSeq`. */
  readonly countAfter: (scope: ResolvedScope, afterSeq: number) => Effect.Effect<number>
  /** The highest committed seq, 0 when there are none. */
  readonly latestSeq: Effect.Effect<number>
  /** A project's latest events on tasks, comments, reviews and asks, newest first. */
  readonly recent: (projectId: string, limit: number) => Effect.Effect<ReadonlyArray<CelloEvent>>
  /** Claims `sessionId` lost in a project (`task.claim_taken`, `task.claim_ended`), newest first. */
  readonly claimsLostBy: (sessionId: string, projectId: string, limit: number) => Effect.Effect<ReadonlyArray<CelloEvent>>
  /** The latest wake event (CEL-92) of each of these tasks that has one. */
  readonly latestWakes: (taskIds: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<CelloEvent>>
}>()("cello/EventStore") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  const scopeWhere = (scope: ResolvedScope, afterSeq: number) =>
    scope.projectId === null
      ? sql`workspace_id = ${scope.workspaceId} AND seq > ${afterSeq}`
      : sql`seq > ${afterSeq} AND (project_id = ${scope.projectId} OR (project_id IS NULL AND workspace_id = ${scope.workspaceId}))`

  const append = Effect.fn("EventStore.append")(function* (body: EventBody, context: EventContext) {
    const entity = entityOf(body)
    const { type, ...payload } = body
    const rows = yield* sql<{ seq: number }>`
      INSERT INTO events (ts, type, entity_type, entity_id, workspace_id, project_id, command_id, actor_id, session_id,
                          agent_id, model, effort, schema_version, payload, created_at)
      VALUES (${context.ts}, ${type}, ${entity.type}, ${entity.id}, ${context.workspaceId}, ${context.projectId},
              ${context.commandId}, ${context.actorId}, ${context.sessionId}, ${context.agentId}, ${context.model},
              ${context.effort}, ${CURRENT_SCHEMA_VERSION}, ${JSON.stringify(payload)}, ${context.ts})
      RETURNING seq`
    return { ...context, ...body, seq: rows[0]!.seq, schemaVersion: CURRENT_SCHEMA_VERSION } as CelloEvent
  })

  const history = Effect.fn("EventStore.history")(function* (entityId: string) {
    const rows = yield* sql<EventRow>`SELECT * FROM events WHERE entity_id = ${entityId} ORDER BY seq`
    return rows.map(decodeRow)
  }, Effect.orDie)

  const resolveScope = Effect.fn("EventStore.resolveScope")(function* (scope: Scope) {
    if ("workspaceId" in scope) return { workspaceId: scope.workspaceId, projectId: null }
    const rows = yield* sql<{ workspace_id: string }>`SELECT workspace_id FROM projects WHERE id = ${scope.projectId}`
    return { workspaceId: rows[0]?.workspace_id ?? "", projectId: scope.projectId }
  }, Effect.orDie)

  const readAfter = Effect.fn("EventStore.readAfter")(function* (scope: ResolvedScope, afterSeq: number) {
    const rows = yield* sql<EventRow>`SELECT * FROM events WHERE ${scopeWhere(scope, afterSeq)} ORDER BY seq`
    return rows.map(decodeRow)
  }, Effect.orDie)

  const countAfter = Effect.fn("EventStore.countAfter")(function* (scope: ResolvedScope, afterSeq: number) {
    const rows = yield* sql<{ count: number }>`SELECT COUNT(*) AS count FROM events WHERE ${scopeWhere(scope, afterSeq)}`
    return rows[0]!.count
  }, Effect.orDie)

  const latestSeq = sql<{ seq: number }>`SELECT COALESCE(MAX(seq), 0) AS seq FROM events`.pipe(
    Effect.map((rows) => rows[0]!.seq),
    Effect.orDie,
    Effect.withSpan("EventStore.latestSeq"),
  )

  // A session taking a comment (CEL-76) is a receipt, not activity: Recent activity leaves it out. Testing
  // profile changes (CEL-89) are in it, so agents see who changed how the repo is tested.
  const recent = Effect.fn("EventStore.recent")(function* (projectId: string, limit: number) {
    const rows = yield* sql<EventRow>`
      SELECT * FROM events WHERE project_id = ${projectId} AND entity_type IN ('task', 'comment', 'review', 'ask', 'profile')
        AND type != 'comment.delivered'
      ORDER BY seq DESC LIMIT ${limit}`
    return rows.map(decodeRow)
  }, Effect.orDie)

  const claimsLostBy = Effect.fn("EventStore.claimsLostBy")(function* (sessionId: string, projectId: string, limit: number) {
    const rows = yield* sql<EventRow>`
      SELECT * FROM events WHERE project_id = ${projectId} AND type IN ('task.claim_taken', 'task.claim_ended')
        AND json_extract(payload, '$.from.sessionId') = ${sessionId}
      ORDER BY seq DESC LIMIT ${limit}`
    return rows.map(decodeRow)
  }, Effect.orDie)

  const latestWakes = Effect.fn("EventStore.latestWakes")(function* (taskIds: ReadonlyArray<string>) {
    if (taskIds.length === 0) return []
    const rows = yield* sql<EventRow>`
      SELECT * FROM events WHERE seq IN (
        SELECT MAX(seq) FROM events WHERE type IN ${sql.in([...WAKE_EVENTS])} AND ${sql.in("entity_id", [...taskIds])} GROUP BY entity_id)
      ORDER BY seq`
    return rows.map(decodeRow)
  }, Effect.orDie)

  return EventStore.of({ append, history, resolveScope, readAfter, countAfter, latestSeq, recent, claimsLostBy, latestWakes })
})

export const layer = Layer.effect(EventStore, make)
