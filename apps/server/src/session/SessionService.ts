// Agent sessions: the CLI's identity headers become an `agent_sessions` row, created on first sight
// and touched (`last_seen_at`) on every call. Each session hangs off one agent actor per client
// ("Claude Code"). No session, or the session "me", is the human.
//
// Presence (CEL-35): while a session holds a claim, boards hear when it checks in (`session.seen`, at
// most once every PRESENCE_EVERY_MS per workspace) and when its process exits (`sweep`, which sets
// `ended_at`). A call from an ended session (a resumed conversation) clears `ended_at` again.
import type { AgentSession } from "@cello/contract/entities"
import { Caller, HUMAN_SESSION } from "@cello/contract/rpcs"
import { colorFromSeed } from "@cello/shared/color"
import { redact } from "@cello/shared/redact"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import type { SqlError } from "effect/sql/SqlError"
import * as Commands from "../commands/Commands.ts"
import { newId } from "../persistence/ids.ts"
import * as Seed from "../persistence/Seed.ts"
import { isAlive } from "../process/isAlive.ts"
import { parseRuns, runsOf, stored, testsOf, testsTurnEnded } from "./activity.ts"
import { recordFinished } from "./testOutcomes.ts"

/** What a request says about its caller, decoded from the identity headers. */
export interface Identity {
  readonly session?: string | undefined
  readonly client?: string | undefined
  readonly pid?: number | undefined
  readonly cwd?: string | undefined
  readonly entrypoint?: string | undefined
  /** The terminal app it runs in, from TERM_PROGRAM (CEL-137); kept until it reports another. */
  readonly terminal?: string | undefined
  /** The session's subagent making the call (CEL-55): its host id, and what it was launched as. */
  readonly agent?: string | undefined
  readonly agentType?: string | undefined
  /** The session's permission mode as its host reports it (Claude Code's hooks, CEL-92); kept until it reports another. */
  readonly permissionMode?: string | undefined
  /**
   * The caller's Claude Code transcript as its hook reports it (CEL-106): the session's own file, or with
   * `agent` the subagent's. Kept until it reports another; only ever read through the agentLog guard.
   */
  readonly transcript?: string | undefined
  /** Its last tool call in one line ("Bash · bun run test"), from the PostToolUse hook (CEL-106). */
  readonly step?: string | undefined
}

/** Which agent CLI a client is (CEL-92), so the session host knows which adapter can continue its sessions. */
export const AGENT_KINDS: Readonly<Record<string, string>> = { "Claude Code": "claude-code" }

/** Longest agent id, type or description kept: hosts use short ids; anything longer is cut, never refused. */
export const MAX_AGENT_TEXT = 200

/** Control characters (C0, DEL, C1): never kept in text that came from outside and lands on a board or a terminal. */
export const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g

/** An agent id or type from outside, without control characters, trimmed and capped; empty is none. */
export const cleanAgentText = (value: string | null | undefined): string | null => {
  const text = value?.replace(CONTROL_CHARACTERS, "").trim().slice(0, MAX_AGENT_TEXT)
  return text ? text : null
}

/** Longest transcript path kept. */
export const MAX_TRANSCRIPT_PATH = 1024

/**
 * A reported transcript path as kept (CEL-106): an absolute `.jsonl` path without control characters,
 * else none. Where it points is checked when it's read (agentLog/transcriptPath.ts), not here.
 */
export const cleanTranscript = (value: string | null | undefined): string | null => {
  const text = value?.trim()
  if (!text || text.length > MAX_TRANSCRIPT_PATH || new RegExp(CONTROL_CHARACTERS.source).test(text)) return null
  return text.startsWith("/") && text.endsWith(".jsonl") ? text : null
}

/** A reported current step as kept (CEL-106): one line, capped, keys masked; empty is none. */
export const cleanStep = (value: string | null | undefined): string | null => {
  const text = value?.replace(CONTROL_CHARACTERS, " ").replace(/\s+/g, " ").trim().slice(0, MAX_AGENT_TEXT)
  return text ? redact(text).text : null
}

/** What a hook reported about the caller's log (CEL-106): its transcript and current step, each null when it said nothing. */
export interface LogReport {
  readonly transcript: string | null
  readonly step: string | null
}

export const NO_LOG_REPORT: LogReport = { transcript: null, step: null }

/**
 * Records a call from a session's subagent (CEL-55): created on first sight with its type, else seen
 * now, a type learnt late filled in, and an ended (resumed) or waiting (CEL-133) agent working again; a
 * transcript or current step its hook reported replaces the one kept (CEL-106), and the folder its call
 * ran in (CEL-152) the one kept, a call that says none leaving it. AgentService has the rest.
 */
export const touchAgent = (
  sql: SqlClient.SqlClient,
  sessionId: string,
  agentId: string,
  agentType: string | null,
  now: number,
  log: LogReport = NO_LOG_REPORT,
  cwd: string | null = null,
) =>
  sql`INSERT INTO session_agents (session_id, agent_id, agent_type, started_at, last_seen_at, transcript_path, current_step, current_step_at, cwd)
    VALUES (${sessionId}, ${agentId}, ${agentType}, ${now}, ${now}, ${log.transcript}, ${log.step}, ${log.step === null ? null : now}, ${cwd})
    ON CONFLICT (session_id, agent_id) DO UPDATE SET
      last_seen_at = excluded.last_seen_at, ended_at = NULL, waiting_json = NULL, verdict = NULL, agent_type = COALESCE(excluded.agent_type, agent_type),
      cwd = COALESCE(excluded.cwd, cwd),
      transcript_path = COALESCE(excluded.transcript_path, transcript_path),
      current_step = COALESCE(excluded.current_step, current_step),
      current_step_at = COALESCE(excluded.current_step_at, current_step_at)`

/** A claim holder with no pid is gone after this long without a call. */
export const IDLE_CLAIM_MS = 2 * 60 * 60 * 1000

/**
 * Boards hear a session check in at most this often (per workspace), however many calls it makes.
 * Well inside ACTIVE_MS (5 min, @cello/shared/presence), so a working session reads "active now"
 * throughout. Each one plays the card's burst (CEL-69, CEL-76), so a minute keeps a busy card moving
 * now and then; it's one `session.seen` row per working session and workspace a minute (was 2 minutes;
 * docs/internals/receipts-and-activity.md has the numbers).
 */
export const PRESENCE_EVERY_MS = 60_000

/**
 * Marks a session ended, but only if nothing changed since `seen` was read: still not ended and not
 * checked in since (`last_seen_at` as read). A session resuming between the sweep's read and this write
 * stays live. Returns whether it was ended. Runs inside the command that tells the boards.
 */
export const endIfUnchanged = (sql: SqlClient.SqlClient, seen: Pick<AgentSession, "id" | "lastSeenAt">, now: number) =>
  sql<{ id: string }>`
    UPDATE agent_sessions SET ended_at = ${now}
    WHERE id = ${seen.id} AND ended_at IS NULL AND last_seen_at = ${seen.lastSeenAt}
    RETURNING id`.pipe(Effect.map((rows) => rows.length > 0))

/**
 * What the sweep does for a gone session, in the command that tells the boards (CEL-181): `endIfUnchanged`,
 * and only when that ended it, its test runs that are still open, and those of its subagents that haven't
 * stopped, end as "ended" (nothing of it is left to end them), each with its `tests.finished` on its task.
 * Returns whether the session was ended; a sweep that lost the race ends and writes nothing.
 */
export const endGone = (sql: SqlClient.SqlClient, emit: Commands.WriteContext["emit"], seen: Pick<AgentSession, "id" | "lastSeenAt">, now: number) =>
  Effect.gen(function* () {
    if (!(yield* endIfUnchanged(sql, seen, now))) return false
    const holders = yield* sql<{ agent_id: string | null; tests_json: string }>`
      SELECT NULL AS agent_id, tests_json FROM agent_sessions WHERE id = ${seen.id} AND tests_json IS NOT NULL
      UNION ALL
      SELECT agent_id, tests_json FROM session_agents WHERE session_id = ${seen.id} AND ended_at IS NULL AND tests_json IS NOT NULL`
    for (const holder of holders) {
      const before = parseRuns(holder.tests_json)
      const after = before.map((run) => testsTurnEnded(run, [], now))
      if (!after.some((run, i) => run !== before[i])) continue
      const kept = stored(yield* recordFinished(sql, emit, before, after, { sessionId: seen.id, agentId: holder.agent_id }))
      yield* holder.agent_id === null
        ? sql`UPDATE agent_sessions SET tests_json = ${kept} WHERE id = ${seen.id}`
        : sql`UPDATE session_agents SET tests_json = ${kept} WHERE session_id = ${seen.id} AND agent_id = ${holder.agent_id}`
    }
    return true
  })

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
  /**
   * After a session's request: if it holds a claim, tells the boards of each workspace it holds one in
   * that it's working (`session.seen`), unless they heard within PRESENCE_EVERY_MS. The human: nothing.
   */
  readonly checkIn: (caller: Caller["Service"]) => Effect.Effect<void>
  /**
   * Sessions holding a claim whose process exited (or, without a pid, that were quiet IDLE_CLAIM_MS)
   * are marked ended, and their boards hear it. Returns how many. PresenceWatch runs it on a timer.
   */
  readonly sweep: Effect.Effect<number>
  /**
   * Runs `wait` (an `inbox.wait`, CEL-76) with the calling session counted as waiting: `byIds` says so
   * while any of its waits is open, and boards hear `session.waiting` when the first opens and the
   * last closes, however it ends (a comment, a dropped connection, a stopping server). The human: none.
   */
  readonly waitingWhile: <A, E, R>(wait: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R | Caller>
  /**
   * For the command in which a session's wait hands it its new items (CEL-76): the session woke and is
   * starting on them, so it's seen now and no longer waiting, and the boards where it holds a claim hear
   * that (`session.seen`) in the same change as the delivery, whatever PRESENCE_EVERY_MS says. Without
   * it a board would show it waiting, last seen when the wait opened, until its next check-in.
   */
  readonly wokeWithin: (context: Commands.WriteContext, sessionId: string) => Effect.Effect<void, SqlError>
  /**
   * Tells the boards where the session holds a claim what it's doing now (`session.seen`), whatever
   * PRESENCE_EVERY_MS says: its test run started, moved or ended (CEL-134).
   */
  readonly announce: (sessionId: string) => Effect.Effect<void>
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
  /** CEL-106; left out by selects that don't need them. */
  transcript_path?: string | null
  current_step?: string | null
  current_step_at?: number | null
  /** CEL-119; left out by selects that don't need them. */
  model?: string | null
  effort?: string | null
  /** CEL-124; left out by selects that don't need it. */
  orchestrating?: number
  /** CEL-134; left out by selects that don't need it. */
  tests_json?: string | null
  /** CEL-137. */
  terminal?: string | null
}

/** A session's latest woken run (CEL-137), as boards get it. */
type LastRun = NonNullable<AgentSession["lastRun"]>

/** Longest terminal app name kept: TERM_PROGRAM values are short; anything longer is cut, never refused. */
const MAX_TERMINAL = 64

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
  hasLog: r.transcript_path != null,
  currentStep: r.current_step ?? null,
  currentStepAt: r.current_step_at ?? null,
  model: r.model ?? null,
  effort: r.effort ?? null,
  orchestrating: r.orchestrating === 1,
  tests: testsOf(r.tests_json),
  runs: runsOf(r.tests_json),
  terminal: r.terminal ?? null,
})

/** Client name for sessions that don't say which client they are. */
export const UNKNOWN_CLIENT = "Agent"

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const human = yield* Seed.HumanActor
  const commands = yield* Commands.Commands
  /** When each `<session> <workspace>` last got a session.seen. In memory: a restart sends one again. */
  const heard = new Map<string, number>()
  /** Sessions with an `inbox.wait` open right now (CEL-76), and how many. In memory: a restart has none. */
  const waiters = new Map<string, number>()

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
    const agentId = cleanAgentText(identity.agent)
    const mode = cleanAgentText(identity.permissionMode)
    const terminal = cleanAgentText(identity.terminal)?.slice(0, MAX_TERMINAL) ?? null
    const kind = AGENT_KINDS[client] ?? null
    const log: LogReport = { transcript: cleanTranscript(identity.transcript), step: cleanStep(identity.step) }
    // A subagent's call reports the subagent's log (CEL-106), never the session's.
    const own = agentId === null ? log : NO_LOG_REPORT
    return yield* sql.withTransaction(Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const stepAt = own.step === null ? null : now
      // The raw identity, without the log report (CEL-106): the step can hold a key and is kept only
      // masked (current_step), and the transcript has its own column.
      // The terminal app as it's kept (CEL-137): cleaned and capped, here too.
      const { step: _step, transcript: _transcript, terminal: _terminal, ...kept } = identity
      const raw = JSON.stringify(terminal === null ? kept : { ...kept, terminal })
      const existing = yield* sql<{ id: string; actor_id: string }>`
        SELECT id, actor_id FROM agent_sessions WHERE external_id = ${external}`
      let caller: { actorId: string; sessionId: string }
      if (existing[0]) {
        // While Cello runs it (a woken run), its calls don't say where it runs: it keeps where it was
        // started (CEL-137). The CLI leaves both out under CELLO_WOKEN=1; this is the server's own guard.
        const woken = sql`EXISTS (SELECT 1 FROM session_runs WHERE session_id = ${existing[0].id} AND ended_at IS NULL)`
        yield* sql`UPDATE agent_sessions SET last_seen_at = ${now}, ended_at = NULL, pid = COALESCE(${identity.pid ?? null}, pid),
            cwd = ${agentId === null ? sql`COALESCE(${identity.cwd ?? null}, cwd)` : sql`cwd`},
            entrypoint = CASE WHEN ${woken} THEN entrypoint ELSE COALESCE(${identity.entrypoint ?? null}, entrypoint) END,
            terminal = CASE WHEN ${woken} THEN terminal ELSE COALESCE(${terminal}, terminal) END,
            permission_mode = COALESCE(${mode}, permission_mode), agent_kind = COALESCE(agent_kind, ${kind}),
            transcript_path = COALESCE(${own.transcript}, transcript_path), current_step = COALESCE(${own.step}, current_step),
            current_step_at = COALESCE(${stepAt}, current_step_at),
            identity_json = ${raw}
          WHERE id = ${existing[0].id}`
        caller = { actorId: existing[0].actor_id, sessionId: existing[0].id }
      } else {
        const actorId = yield* actorFor(client, external, now)
        const id = newId(now)
        yield* sql`INSERT INTO agent_sessions (id, actor_id, external_id, client_name, entrypoint, terminal, cwd, project_id, pid,
                                               permission_mode, agent_kind, transcript_path, current_step, current_step_at,
                                               identity_json, started_at, last_seen_at, created_at)
          VALUES (${id}, ${actorId}, ${external}, ${client}, ${identity.entrypoint ?? null}, ${terminal}, ${identity.cwd ?? null}, NULL,
                  ${identity.pid ?? null}, ${mode}, ${kind}, ${own.transcript}, ${own.step}, ${stepAt},
                  ${raw}, ${now}, ${now}, ${now})`
        caller = { actorId, sessionId: id }
      }
      // A subagent's call (CEL-55): recorded under the session, and the caller says which agent it is. Its folder
      // is its own (CEL-152): it never replaces the session's, which only the session's own calls set.
      if (agentId === null) return caller
      yield* touchAgent(sql, caller.sessionId, agentId, cleanAgentText(identity.agentType), now, log, identity.cwd ?? null)
      return { ...caller, agentId }
    }))
  }, Effect.orDie)

  const byIds = Effect.fn("SessionService.byIds")(function* (ids: ReadonlyArray<string>) {
    if (ids.length === 0) return []
    const unique = [...new Set(ids)]
    const rows = yield* sql<SessionRow>`SELECT * FROM agent_sessions WHERE ${sql.in("id", unique)} ORDER BY started_at, id`
    // Each one's latest woken run (CEL-137): newest first, so the first seen per session is it.
    const runs = yield* sql<{ id: string; session_id: string; started_at: number; ended_at: number | null }>`
      SELECT id, session_id, started_at, ended_at FROM session_runs WHERE ${sql.in("session_id", unique)} ORDER BY started_at DESC, id DESC`
    const lastRuns = new Map<string, LastRun>()
    for (const r of runs) if (!lastRuns.has(r.session_id)) lastRuns.set(r.session_id, { id: r.id, startedAt: r.started_at, endedAt: r.ended_at })
    return rows.map((r) => ({ ...toSession(r), waiting: waiters.has(r.id), lastRun: lastRuns.get(r.id) ?? null }))
  }, Effect.orDie)

  /** The workspaces where a session holds a claim on a task that isn't archived. */
  const claimWorkspaces = (sessionId: string) =>
    sql<{ workspace_id: string }>`
      SELECT DISTINCT p.workspace_id FROM tasks t JOIN projects p ON p.id = t.project_id
      WHERE t.assignee_session_id = ${sessionId} AND t.archived_at IS NULL`.pipe(Effect.map((rows) => rows.map((r) => r.workspace_id)))

  /**
   * One session.seen per workspace, as the session itself, with no receipt (nobody retries it). `first`
   * runs in the same command and can call it off (false): the event and its change commit together.
   */
  const tell = (
    session: AgentSession,
    workspaceIds: ReadonlyArray<string>,
    now: number,
    first?: (context: Commands.WriteContext) => Effect.Effect<boolean, SqlError>,
  ) =>
    commands.write({ commandId: crypto.randomUUID(), rpc: "session.seen", receipt: false }, (context) =>
      Effect.gen(function* () {
        const { emit } = context
        if (first !== undefined && !(yield* first(context))) return false
        // What `first` changed (the sweep ends the session's test runs, CEL-181) is what boards are told:
        // the runs as they are now, not as they were read before.
        const [row] = first === undefined ? [] : yield* sql<SessionRow>`SELECT * FROM agent_sessions WHERE id = ${session.id}`
        const told: AgentSession = row === undefined ? session : { ...session, tests: toSession(row).tests, runs: toSession(row).runs }
        yield* Effect.forEach(workspaceIds, (workspaceId) => emit({ type: "session.seen", session: told }, { workspaceId, projectId: null }), {
          discard: true,
        })
        for (const id of workspaceIds) heard.set(`${session.id} ${id}`, now)
        return true
      })).pipe(Effect.map((written) => written.result), Effect.provideService(Caller, { actorId: session.actorId, sessionId: session.id }))

  const checkIn = Effect.fn("SessionService.checkIn")(function* (caller: Caller["Service"]) {
    if (caller.sessionId === null) return
    const now = yield* Clock.currentTimeMillis
    const due = (yield* claimWorkspaces(caller.sessionId)).filter((w) => {
      const last = heard.get(`${caller.sessionId} ${w}`)
      // A clock set back would otherwise hold every check-in until it caught up.
      return last === undefined || now < last || now - last >= PRESENCE_EVERY_MS
    })
    if (due.length === 0) return
    // Marked before the write, so parallel calls (the hook on parallel tool calls) send it once.
    for (const w of due) heard.set(`${caller.sessionId} ${w}`, now)
    const [session] = yield* byIds([caller.sessionId])
    if (session) yield* tell(session, due, now)
  }, Effect.orDie)

  const announce = Effect.fn("SessionService.announce")(function* (sessionId: string) {
    const now = yield* Clock.currentTimeMillis
    const workspaces = yield* claimWorkspaces(sessionId)
    const [session] = yield* byIds([sessionId])
    if (session && workspaces.length > 0) yield* tell(session, workspaces, now)
  }, Effect.orDie)

  const sweep = Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    const holding = yield* sql<SessionRow>`
      SELECT * FROM agent_sessions WHERE ended_at IS NULL
        AND id IN (SELECT assignee_session_id FROM tasks WHERE assignee_session_id IS NOT NULL AND archived_at IS NULL)`
    const gone = holding.map(toSession).filter((s) => isGone(s, now) !== false)
    let ended = 0
    for (const session of gone) {
      // Ended and told in one command, and only if it hasn't checked in since it was read.
      if (!(yield* tell({ ...session, endedAt: now }, yield* claimWorkspaces(session.id), now, ({ emit }) => endGone(sql, emit, session, now)))) continue
      ended++
      // Its next call (a resumed session) must reach the boards at once, whatever the throttle says.
      for (const key of heard.keys()) if (key.startsWith(`${session.id} `)) heard.delete(key)
    }
    return ended
  }).pipe(Effect.orDie, Effect.withSpan("SessionService.sweep"))

  /** Tells the boards where the session holds claims that it started or stopped waiting. */
  const tellWaiting = (sessionId: string, waiting: boolean) =>
    Effect.gen(function* () {
      const [session] = yield* byIds([sessionId])
      if (!session) return
      const workspaceIds = yield* claimWorkspaces(sessionId)
      if (workspaceIds.length === 0) return
      yield* commands.write({ commandId: crypto.randomUUID(), rpc: "session.waiting", receipt: false }, ({ emit }) =>
        Effect.forEach(workspaceIds, (workspaceId) => emit({ type: "session.waiting", session: sessionId, waiting }, { workspaceId, projectId: null }), {
          discard: true,
        })).pipe(Effect.provideService(Caller, { actorId: session.actorId, sessionId }))
    }).pipe(Effect.orDie)

  /** One wait of the session ended: true when it was the last. */
  const release = (id: string): boolean => {
    const n = (waiters.get(id) ?? 1) - 1
    if (n > 0) {
      waiters.set(id, n)
      return false
    }
    waiters.delete(id)
    return true
  }

  const waitingWhile = <A, E, R>(wait: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const id = (yield* Caller).sessionId
      if (id === null) return yield* wait
      return yield* Effect.acquireUseRelease(
        Effect.suspend(() => {
          const n = (waiters.get(id) ?? 0) + 1
          waiters.set(id, n)
          if (n > 1) return Effect.void
          // Counted first, so a second wait arriving meanwhile doesn't tell the boards again; taken back
          // if telling them fails, since then the release (and its "stopped") never runs.
          return tellWaiting(id, true).pipe(Effect.onError(() => Effect.sync(() => release(id))))
        }),
        () => wait,
        () =>
          Effect.suspend(() =>
            // A server stopping mid-wait may not get to tell anyone: its restart starts with no waiters.
            release(id) ? tellWaiting(id, false).pipe(Effect.catchCause(() => Effect.void)) : Effect.void
          ),
      )
    })

  const wokeWithin = (context: Commands.WriteContext, sessionId: string) =>
    Effect.gen(function* () {
      yield* sql`UPDATE agent_sessions SET last_seen_at = ${context.now} WHERE id = ${sessionId}`
      const [row] = yield* sql<SessionRow>`SELECT * FROM agent_sessions WHERE id = ${sessionId}`
      if (!row) return
      // Not waiting from here on, though the wait's own release (and its session.waiting) comes after.
      const session: AgentSession = { ...toSession(row), waiting: false }
      const workspaceIds = yield* claimWorkspaces(sessionId)
      yield* Effect.forEach(workspaceIds, (workspaceId) => context.emit({ type: "session.seen", session }, { workspaceId, projectId: null }), {
        discard: true,
      })
      for (const id of workspaceIds) heard.set(`${sessionId} ${id}`, context.now)
    }).pipe(Effect.withSpan("SessionService.wokeWithin"))

  return SessionService.of({ resolve, byIds, checkIn, sweep, waitingWhile, wokeWithin, announce })
})

export const layer = Layer.effect(SessionService, make)
