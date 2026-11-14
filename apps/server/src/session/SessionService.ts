// Agent sessions: the CLI's identity headers become an `agent_sessions` row, created on first sight
// and touched (`last_seen_at`) on every call. Each session hangs off one agent actor per client
// ("Claude Code"). No session, or the session "me", is the human.
import type { AgentSession } from "@cello/contract/entities"
import { HUMAN_SESSION, type Caller } from "@cello/contract/rpcs"
import { colorFromSeed } from "@cello/shared/color"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import { newId } from "../persistence/ids.ts"
import * as Seed from "../persistence/Seed.ts"
import { isAlive } from "../process/isAlive.ts"

/** What a request says about its caller, decoded from the identity headers. */
export interface Identity {
  readonly session?: string | undefined
  readonly client?: string | undefined
  readonly pid?: number | undefined
  readonly cwd?: string | undefined
  readonly entrypoint?: string | undefined
}

/** A claim holder with no pid is gone after this long without a call. */
export const IDLE_CLAIM_MS = 2 * 60 * 60 * 1000

/**
 * Whether a session holding a claim is gone: its process exited (checked by pid, since the server
 * runs on the same machine), or, with no pid, 2 hours passed without a call. Returns why, or false.
 */
export const isGone = (
  session: Pick<AgentSession, "pid" | "lastSeenAt">,
  now: number,
): false | "holder_exited" | "holder_idle" => {
  if (session.pid !== null) return isAlive(session.pid) ? false : "holder_exited"
  return now - session.lastSeenAt > IDLE_CLAIM_MS ? "holder_idle" : false
}

export class SessionService extends Context.Service<SessionService, {
  /** The caller for an identity, creating or touching its session. */
  readonly resolve: (identity: Identity) => Effect.Effect<Caller["Service"]>
  /** Sessions by id; unknown ids are left out. */
  readonly byIds: (ids: ReadonlyArray<string>) => Effect.Effect<ReadonlyArray<AgentSession>>
}>()("cello/SessionService") {}

interface SessionRow {
  id: string
  actor_id: string
  external_id: string | null
  client_name: string
  entrypoint: string | null
  cwd: string | null
  pid: number | null
  started_at: number
  last_seen_at: number
  ended_at: number | null
}

export const toSession = (r: SessionRow): AgentSession => ({
  id: r.id,
  actorId: r.actor_id,
  externalId: r.external_id,
  clientName: r.client_name,
  entrypoint: r.entrypoint,
  cwd: r.cwd,
  pid: r.pid,
  startedAt: r.started_at,
  lastSeenAt: r.last_seen_at,
  endedAt: r.ended_at,
})

/** Client name for sessions that don't say which client they are. */
export const UNKNOWN_CLIENT = "Agent"

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const human = yield* Seed.HumanActor

  /** The agent actor for a client, created with a color from the first session that names it. */
  const actorFor = (client: string, session: string, now: number) =>
    Effect.gen(function* () {
      const found = yield* sql<{ id: string }>`SELECT id FROM actors WHERE kind = 'agent' AND client = ${client} LIMIT 1`
      if (found[0]) return found[0].id
      const id = newId(now)
      yield* sql`INSERT INTO actors (id, kind, name, client, color, created_at)
        VALUES (${id}, 'agent', ${client}, ${client}, ${colorFromSeed(session)}, ${now})`
      return id
    })

  const resolve = Effect.fn("SessionService.resolve")(function* (identity: Identity) {
    const external = identity.session?.trim()
    if (!external || external === HUMAN_SESSION) return { actorId: human.id, sessionId: null }
    const client = identity.client?.trim() || UNKNOWN_CLIENT
    return yield* sql.withTransaction(Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const raw = JSON.stringify(identity)
      const existing = yield* sql<{ id: string; actor_id: string }>`
        SELECT id, actor_id FROM agent_sessions WHERE external_id = ${external}`
      if (existing[0]) {
        yield* sql`UPDATE agent_sessions SET last_seen_at = ${now}, pid = COALESCE(${identity.pid ?? null}, pid),
            cwd = COALESCE(${identity.cwd ?? null}, cwd), entrypoint = COALESCE(${identity.entrypoint ?? null}, entrypoint),
            identity_json = ${raw}
          WHERE id = ${existing[0].id}`
        return { actorId: existing[0].actor_id, sessionId: existing[0].id }
      }
      const actorId = yield* actorFor(client, external, now)
      const id = newId(now)
      yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, entrypoint, cwd, project_id, pid,
                                             identity_json, started_at, last_seen_at, created_at)
        VALUES (${id}, ${actorId}, ${external}, ${client}, ${identity.entrypoint ?? null}, ${identity.cwd ?? null}, NULL,
                ${identity.pid ?? null}, ${raw}, ${now}, ${now}, ${now})`
      return { actorId, sessionId: id }
    }))
  }, Effect.orDie)

  const byIds = Effect.fn("SessionService.byIds")(function* (ids: ReadonlyArray<string>) {
    if (ids.length === 0) return []
    const rows = yield* sql<SessionRow>`SELECT * FROM agent_sessions WHERE ${sql.in("id", [...new Set(ids)])} ORDER BY started_at, id`
    return rows.map(toSession)
  }, Effect.orDie)

  return SessionService.of({ resolve, byIds })
})

export const layer = Layer.effect(SessionService, make)
