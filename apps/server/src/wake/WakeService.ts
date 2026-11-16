// Waking sessions (CEL-92): when Lucas acts on a task an agent session claimed and nothing of that
// session is running, Cello continues the same conversation itself (SessionHost), headless. This is the
// only place with the rules: the board's actions, `cello sessions wake` and later the chat all decide here.
//
// What wakes: Lucas's comment, his answers to an ask, a Send back, or his reaction, on a task the
// session holds the claim on. Never a timer, another agent, or a board change.
//
// Batching: a wake is due BATCH (30 s) after Lucas's last action on the session's tasks, and each new
// action restarts the wait, so three quick comments make one wake. A session whose process just went
// away waits until it has been quiet QUIET (2 min). While a wake is due the card says so
// (`session.wake_scheduled`) and Lucas can call it off.
//
// The checks, in order, when a wake is due (and before announcing one). The first that fails decides:
//  1. the session is listening (its `cello inbox --wait` is open): it hears the comment by itself
//  2. it has nothing unread on the task any more: it took the comment itself (silent, unless announced)
//  3. a woken run of it is going already (one run per session), or one a crashed server left behind
//     still has a live process
//  4. Cello knows no process id for it, or 5. that process is still running (two processes on one
//     conversation would corrupt it), or 6. it checked in within QUIET
//  7. waking is off for the task's project (the default), or 8. the task reached its cap of wakes this
//     hour (a batched run counts for each of its tasks)
//  9. no driver can continue it, or its CLI isn't installed; 10. its recorded permission mode is one the
//     CLI doesn't have, or bypass (never used for a woken run)
// 11. its folder isn't an absolute folder that exists here; 12. its conversation isn't kept for that
//     folder or one above it (where the run then starts)
// A wake that doesn't happen is a `session.not_woken` with the reason, on the card and in the history.
import * as fs from "node:fs"
import * as path from "node:path"
import type { NotWokenReason, ProjectRef, SessionRun, WakeSettings, WakeWhy } from "@cello/contract/entities"
import { HumanOnly, Invalid, NotFound, SessionNotWoken } from "@cello/contract/errors"
import type { CelloEvent } from "@cello/contract/events"
import { Caller } from "@cello/contract/rpcs"
import { formatTaskKey } from "@cello/shared/taskKey"
import { andList } from "@cello/shared/words"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as FiberMap from "effect/FiberMap"
import * as Layer from "effect/Layer"
import * as Semaphore from "effect/Semaphore"
import * as Stream from "effect/Stream"
import * as SqlClient from "effect/sql/SqlClient"
import * as Commands from "../commands/Commands.ts"
import * as EventLog from "../events/EventLog.ts"
import * as Seed from "../persistence/Seed.ts"
import * as ProjectService from "../project/ProjectService.ts"
import { SessionService } from "../session/SessionService.ts"
import { type AgentDriver, type AgentMode, AgentRegistry } from "./agents/AgentDriver.ts"
import { type RunSession, SessionHost } from "./SessionHost.ts"
import { WakeConfig } from "./WakeConfig.ts"

/** A project's settings until Lucas changes them: off, 3 wakes per task per hour. */
export const DEFAULT_CAP = 3
export const MAX_CAP = 20

/** How far back the cap counts. */
const CAP_WINDOW_MS = 60 * 60_000

/** Which of Lucas's actions wins when several on one task are batched (a Send back also adds its note as a comment). */
const STRENGTH: Record<WakeWhy, number> = { reaction: 0, comment: 1, answers: 2, send_back: 3, manual: 4 }

/** The prompt a woken run gets. Delivery goes through the session itself: it runs `cello inbox`. */
export const wakePrompt = (input: { readonly human: string; readonly keys: ReadonlyArray<string>; readonly manual: boolean }) => {
  const tasks = andList(input.keys)
  return input.manual
    ? `${input.human} asked Cello to wake this session for ${tasks}, which you claimed: run \`cello inbox\` and check the card, then carry on and answer there. ` +
      "Cello woke this session because its process had ended."
    : `${input.human} acted on ${tasks}, which you claimed: run \`cello inbox\` and act on it, then answer on the card. ` +
      "Cello woke this session because its process had ended."
}

export interface WakeNow {
  readonly commandId: string
  /** A session: its host id, an unambiguous start of it (4 characters or more), or Cello's id. */
  readonly session?: string | undefined
  /** A task key: its claim holder. */
  readonly key?: string | undefined
}

export class WakeService extends Context.Service<WakeService, {
  /** One of Lucas's actions on a task: a wake of its claim holder is due BATCH from now (`watch` calls it). */
  readonly noteAction: (taskId: string, why: WakeWhy) => Effect.Effect<void>
  /** `cello sessions wake`: the same checks, now. */
  readonly wakeNow: (input: WakeNow) => Effect.Effect<Commands.Written<SessionRun>, NotFound | Invalid | SessionNotWoken, Caller>
  /** "Don't wake": calls off the wake due for the task; false when none was due. */
  readonly cancel: (input: { readonly commandId: string; readonly taskId: string }) => Effect.Effect<Commands.Written<boolean>, NotFound, Caller>
  /** The card's Stop; false when the run isn't going. */
  readonly stopRun: (input: { readonly commandId: string; readonly runId: string }) => Effect.Effect<Commands.Written<boolean>, NotFound, Caller>
  readonly settings: (ref: ProjectRef) => Effect.Effect<WakeSettings, NotFound | Invalid>
  readonly setSettings: (input: {
    readonly commandId: string
    readonly project: ProjectRef
    readonly enabled?: boolean | undefined
    readonly capPerHour?: number | undefined
  }) => Effect.Effect<Commands.Written<WakeSettings>, NotFound | Invalid | HumanOnly, Caller>
  /** A session's woken runs, newest first, with their log files. */
  readonly runs: (session: string) => Effect.Effect<{ readonly session: string; readonly runs: ReadonlyArray<{ readonly run: SessionRun; readonly log: string }> }, NotFound | Invalid>
  /** Follows every committed change and notes Lucas's actions. Runs for the server's lifetime. */
  readonly watch: Effect.Effect<never>
}>()("cello/WakeService") {}

interface SessionRow {
  id: string
  actor_id: string
  external_id: string | null
  cwd: string | null
  pid: number | null
  last_seen_at: number
  permission_mode: string | null
  agent_kind: string | null
}

interface TaskRow {
  id: string
  number: number
  project_id: string
  project_key: string
  workspace_id: string
  assignee_session_id: string | null
}

/** The wakes due for one session: its tasks (oldest action first) and the ones the card was told about. */
interface Pending {
  readonly tasks: Map<string, WakeWhy>
  readonly announced: Set<string>
}

type Verdict = { readonly kind: "wake" } | { readonly kind: "skip" } | { readonly kind: "not"; readonly reason: NotWokenReason }

const not = (reason: NotWokenReason): Verdict => ({ kind: "not", reason })

/** A recorded folder a run may start in: an absolute path to a folder that exists here. */
const isFolder = (cwd: string | null): cwd is string => {
  if (cwd === null || !path.isAbsolute(cwd)) return false
  try {
    return fs.statSync(cwd).isDirectory()
  } catch {
    return false
  }
}

/** Lucas's actions that wake, from committed events: the task and why. */
export const actionOf = (e: CelloEvent, humanId: string): { readonly taskId: string; readonly why: WakeWhy } | null => {
  if (e.sessionId !== null || e.actorId !== humanId) return null
  switch (e.type) {
    case "comment.added":
      return { taskId: e.comment.taskId, why: "comment" }
    case "ask.answered":
      return { taskId: e.ask.taskId, why: "answers" }
    case "review.decided":
      return e.decision === "sent_back" ? { taskId: e.taskId, why: "send_back" } : null
    case "reaction.added":
      return { taskId: e.reaction.taskId, why: "reaction" }
    default:
      return null
  }
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const commands = yield* Commands.Commands
  const log = yield* EventLog.EventLog
  const sessions = yield* SessionService
  const projects = yield* ProjectService.ProjectService
  const host = yield* SessionHost
  const registry = yield* AgentRegistry
  const config = yield* WakeConfig
  const human = yield* Seed.HumanActor
  const timers = yield* FiberMap.make<string>()
  const pending = new Map<string, Pending>()
  // Decisions one at a time: a timer firing, an action arriving and `cello sessions wake` never interleave.
  const deciding = yield* Semaphore.make(1)

  const sessionRow = (id: string) => sql<SessionRow>`SELECT * FROM agent_sessions WHERE id = ${id}`.pipe(Effect.map((rows) => rows[0] ?? null))

  const taskRow = (id: string) =>
    sql<TaskRow>`
      SELECT t.id, t.number, t.project_id, p.key AS project_key, p.workspace_id, t.assignee_session_id
      FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ${id} AND t.archived_at IS NULL`.pipe(Effect.map((rows) => rows[0] ?? null))

  const settingsRow = (projectId: string) =>
    sql<{ enabled: number; cap_per_hour: number }>`SELECT enabled, cap_per_hour FROM wake_settings WHERE project_id = ${projectId}`.pipe(
      Effect.map((rows) => ({ enabled: rows[0]?.enabled === 1, capPerHour: rows[0]?.cap_per_hour ?? DEFAULT_CAP })),
    )

  /** Lucas's items the session hasn't taken yet on this task: comments, Send backs, answers, reactions. */
  const unreadOn = (sessionId: string, taskId: string) =>
    Effect.gen(function* () {
      const [items] = yield* sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM inbox_items WHERE session_id = ${sessionId} AND task_id = ${taskId} AND read_at IS NULL`
      const [reactions] = yield* sql<{ n: number }>`
        SELECT COUNT(*) AS n FROM comment_reactions r JOIN comments c ON c.id = r.comment_id
        WHERE r.notify_session_id = ${sessionId} AND c.task_id = ${taskId} AND r.read_at IS NULL`
      return (items?.n ?? 0) + (reactions?.n ?? 0)
    })

  /** Woken runs for the task (its own, or a batched one it was in) that started in the last hour. */
  const recentRuns = (taskId: string, now: number) =>
    sql<{ n: number }>`
      SELECT COUNT(*) AS n FROM session_runs
      WHERE started_at > ${now - CAP_WINDOW_MS}
        AND (task_id = ${taskId} OR EXISTS (SELECT 1 FROM json_each(task_ids) WHERE value = ${taskId}))`.pipe(
      Effect.map((rows) => rows[0]?.n ?? 0),
    )

  /** What it takes to run a session, once the checks pass. */
  interface Runnable {
    readonly session: RunSession
    readonly driver: AgentDriver
    readonly mode: AgentMode
  }

  /**
   * The checks (top of the file) for one session and task. `phase`: `action` (Lucas just acted; the
   * quiet wait is folded into when the wake is due), `fire` (the wake is due), or `manual`.
   */
  const verdict = (row: SessionRow, task: TaskRow, phase: "action" | "fire" | "manual", now: number) =>
    Effect.gen(function* () {
      const no = (v: Verdict): { verdict: Verdict; runnable: Runnable | null } => ({ verdict: v, runnable: null })
      const [session] = yield* sessions.byIds([row.id])
      if (session?.waiting) return no(phase === "manual" ? not("listening") : { kind: "skip" })
      if (phase !== "manual" && (yield* unreadOn(row.id, task.id)) === 0) return no({ kind: "skip" })
      if (yield* host.isRunning(row.id)) return no(not("running"))
      // A run a crashed server left behind lives on: its row says stopped, its process says otherwise.
      const [last] = yield* sql<{ pid: number | null }>`
        SELECT pid FROM session_runs WHERE session_id = ${row.id} AND pid IS NOT NULL ORDER BY started_at DESC, id DESC LIMIT 1`
      if (last?.pid != null && config.isAlive(last.pid)) return no(not("running"))
      if (row.pid === null) return no(not("no_pid"))
      if (config.isAlive(row.pid)) return no(not("process_alive"))
      if (phase !== "action" && now - row.last_seen_at < Duration.toMillis(config.quiet)) return no(not("recent_check_in"))
      const settings = yield* settingsRow(task.project_id)
      if (!settings.enabled) return no(not("disabled"))
      if ((yield* recentRuns(task.id, now)) >= settings.capPerHour) return no(not("cap"))
      const driver = registry.get(row.agent_kind)
      const env = yield* config.env
      if (driver === undefined || !driver.capabilities.resume || !(yield* driver.installed(env))) return no(not("not_installed"))
      const mode = driver.modeFor(row.permission_mode)
      if (mode === null) return no(not("unknown_mode"))
      if (mode.cello === "bypass") return no(not("bypass_mode"))
      if (!isFolder(row.cwd) || row.external_id === null) return no(not("no_folder"))
      // Where the conversation is ties it to the folder: the run starts there.
      const folder = yield* driver.conversationFolder({ nativeId: row.external_id, cwd: row.cwd, env })
      if (folder === null) return no(not("no_conversation"))
      return {
        verdict: { kind: "wake" } as Verdict,
        runnable: { session: { id: row.id, actorId: row.actor_id, externalId: row.external_id, cwd: folder }, driver, mode },
      }
    })

  const placeOf = (task: TaskRow) => ({ workspaceId: task.workspace_id, projectId: task.project_id })

  /** One wake event about a task, as the session, in its own command. */
  const tell = (row: SessionRow, task: TaskRow, body: { type: "scheduled"; why: WakeWhy; at: number } | { type: "not"; why: WakeWhy; reason: NotWokenReason }) =>
    commands.write({ commandId: crypto.randomUUID(), rpc: "session.wake", receipt: false }, ({ emit }) =>
      body.type === "scheduled"
        ? emit({ type: "session.wake_scheduled", session: row.id, taskId: task.id, why: body.why, at: body.at }, placeOf(task))
        : emit({ type: "session.not_woken", session: row.id, taskId: task.id, why: body.why, reason: body.reason }, placeOf(task))).pipe(
        Effect.provideService(Caller, { actorId: row.actor_id, sessionId: row.id }),
      )

  const startRun = (commandId: string, runnable: Runnable, task: TaskRow, all: ReadonlyArray<TaskRow>, why: WakeWhy) =>
    host.start({
      commandId,
      session: runnable.session,
      driver: runnable.driver,
      mode: runnable.mode,
      taskId: task.id,
      taskIds: all.map((t) => t.id),
      why,
      prompt: wakePrompt({ human: human.name, keys: all.map((t) => formatTaskKey(t.project_key, t.number)), manual: why === "manual" }),
      place: placeOf(task),
    })

  /** A session's due wake: the checks again for each task, then one run for the ones that pass. */
  const fire = (sessionId: string) =>
    Effect.gen(function* () {
      const due = pending.get(sessionId)
      pending.delete(sessionId)
      if (!due) return
      const row = yield* sessionRow(sessionId)
      if (!row) return
      const now = yield* Clock.currentTimeMillis
      const woken: Array<{ task: TaskRow; why: WakeWhy; runnable: Runnable }> = []
      for (const [taskId, why] of due.tasks) {
        const task = yield* taskRow(taskId)
        // The claim moved on (released, taken over, ended): nothing to wake it for any more.
        if (!task || task.assignee_session_id !== sessionId) continue
        const { verdict: v, runnable } = yield* verdict(row, task, "fire", now)
        if (v.kind === "wake") woken.push({ task, why, runnable: runnable! })
        else if (v.kind === "not") yield* tell(row, task, { type: "not", why, reason: v.reason })
        else if (due.announced.has(taskId)) yield* tell(row, task, { type: "not", why, reason: "taken" })
      }
      const last = woken.at(-1)
      if (!last) return
      yield* startRun(crypto.randomUUID(), last.runnable, last.task, woken.map((w) => w.task), last.why)
    })

  const noteAction = (taskId: string, why: WakeWhy) =>
    Effect.gen(function* () {
      const task = yield* taskRow(taskId)
      if (!task || task.assignee_session_id === null) return
      const row = yield* sessionRow(task.assignee_session_id)
      if (!row) return
      const now = yield* Clock.currentTimeMillis
      const { verdict: v } = yield* verdict(row, task, "action", now)
      if (v.kind === "skip") return
      const due: Pending = pending.get(row.id) ?? { tasks: new Map(), announced: new Set() }
      const before = due.tasks.get(taskId)
      // Latest last, so the run's task is the one Lucas acted on most recently.
      due.tasks.delete(taskId)
      due.tasks.set(taskId, before !== undefined && STRENGTH[before] > STRENGTH[why] ? before : why)
      pending.set(row.id, due)
      // Due BATCH after this action, and not before the session has been quiet QUIET.
      const at = Math.max(now + Duration.toMillis(config.batch), row.last_seen_at + Duration.toMillis(config.quiet))
      if (v.kind === "wake") {
        due.announced.add(taskId)
        yield* tell(row, task, { type: "scheduled", why: due.tasks.get(taskId)!, at })
      }
      yield* FiberMap.run(timers, row.id, Effect.sleep(Duration.millis(at - now)).pipe(Effect.andThen(decide(fire(row.id)))))
    }).pipe(decide, Effect.withSpan("WakeService.noteAction"))

  /** Runs `effect` as the only decision going on, its storage failures as defects. */
  function decide<A, E, R>(effect: Effect.Effect<A, E, R>) {
    return deciding.withPermits(1)(effect).pipe(Effect.orDie) as Effect.Effect<A, never, R>
  }

  /** A session by its host id, a start of it, or Cello's id. */
  const findSession = (ref: string) =>
    Effect.gen(function* () {
      const text = ref.trim()
      if (text === "") return yield* new Invalid({ field: "session", reason: "name a session: its id, or the start of it" })
      const exact = yield* sql<SessionRow>`SELECT * FROM agent_sessions WHERE external_id = ${text} OR id = ${text}`
      if (exact[0]) return exact[0]
      if (text.length < 4) return yield* new NotFound({ entity: "session", id: text })
      const like = yield* sql<SessionRow>`SELECT * FROM agent_sessions WHERE substr(external_id, 1, ${text.length}) = ${text} LIMIT 2`
      if (like.length > 1) return yield* new Invalid({ field: "session", reason: `more than one session starts with ${text}: give more of its id` })
      if (!like[0]) return yield* new NotFound({ entity: "session", id: text })
      return like[0]
    }).pipe(Effect.catchTag("SqlError", Effect.die))

  const wakeNow = Effect.fn("WakeService.wakeNow")(function* (input: WakeNow) {
    let row: SessionRow
    let task: TaskRow
    if (input.key !== undefined) {
      const key = input.key.trim().toUpperCase()
      const [found] = yield* sql<{ id: string }>`
        SELECT t.id FROM tasks t JOIN projects p ON p.id = t.project_id
        WHERE p.key || '-' || t.number = ${key} AND t.archived_at IS NULL`.pipe(Effect.orDie)
      const t = found ? yield* taskRow(found.id).pipe(Effect.orDie) : null
      if (!t) return yield* new NotFound({ entity: "task", id: key })
      if (t.assignee_session_id === null) return yield* new Invalid({ field: "key", reason: `${key} isn't claimed by an agent session, so there's no session to wake` })
      const holder = yield* sessionRow(t.assignee_session_id).pipe(Effect.orDie)
      if (!holder) return yield* new NotFound({ entity: "session", id: t.assignee_session_id })
      row = holder
      task = t
    } else if (input.session !== undefined) {
      row = yield* findSession(input.session)
      const [held] = yield* sql<{ id: string }>`
        SELECT id FROM tasks WHERE assignee_session_id = ${row.id} AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 1`.pipe(Effect.orDie)
      const t = held ? yield* taskRow(held.id).pipe(Effect.orDie) : null
      if (!t) return yield* new Invalid({ field: "session", reason: "it holds no claim: Cello only wakes a session for a task it claimed" })
      task = t
    } else {
      return yield* new Invalid({ field: "session", reason: "name a session or a task key" })
    }
    const outcome = yield* decide(Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const { verdict: v, runnable } = yield* verdict(row, task, "manual", now)
      if (v.kind !== "wake") {
        const reason = v.kind === "not" ? v.reason : "listening"
        yield* tell(row, task, { type: "not", why: "manual", reason })
        return { kind: "not" as const, reason }
      }
      // Waking now supersedes a wake that was due.
      pending.delete(row.id)
      yield* FiberMap.remove(timers, row.id)
      return { kind: "woken" as const, written: yield* startRun(input.commandId, runnable!, task, [task], "manual") }
    }))
    if (outcome.kind === "not") return yield* new SessionNotWoken({ session: row.external_id ?? row.id, reason: outcome.reason })
    return outcome.written
  })

  const cancel = Effect.fn("WakeService.cancel")(function* (input: { readonly commandId: string; readonly taskId: string }) {
    const task = yield* taskRow(input.taskId).pipe(Effect.orDie)
    if (!task) return yield* new NotFound({ entity: "task", id: input.taskId })
    return yield* decide(Effect.gen(function* () {
      const entry = [...pending.entries()].find(([, due]) => due.tasks.has(task.id))
      if (!entry) return { result: false, seq: null }
      const [sessionId, due] = entry
      const why = due.tasks.get(task.id)!
      due.tasks.delete(task.id)
      due.announced.delete(task.id)
      if (due.tasks.size === 0) {
        pending.delete(sessionId)
        yield* FiberMap.remove(timers, sessionId)
      }
      const row = yield* sessionRow(sessionId)
      if (!row) return { result: true, seq: null }
      const written = yield* tell(row, task, { type: "not", why, reason: "cancelled" })
      return { result: true, seq: written.seq }
    }))
  })

  const stopRun = Effect.fn("WakeService.stopRun")(function* (input: { readonly commandId: string; readonly runId: string }) {
    if ((yield* host.logOf(input.runId)) === null) return yield* new NotFound({ entity: "run", id: input.runId })
    return { result: yield* host.stop(input.runId), seq: null }
  })

  const settingsOf = (projectId: string) =>
    Effect.gen(function* () {
      const row = yield* settingsRow(projectId)
      const env = yield* config.env
      const agents = yield* Effect.forEach(registry.drivers, (d) => Effect.map(d.installed(env), (installed) => ({ kind: d.kind, name: d.name, installed })))
      return { projectId, enabled: row.enabled, capPerHour: row.capPerHour, apiKeySet: Boolean(env.ANTHROPIC_API_KEY), agents }
    })

  const settings = Effect.fn("WakeService.settings")(function* (ref: ProjectRef) {
    const project = yield* projects.resolve(ref)
    return yield* settingsOf(project.id).pipe(Effect.orDie)
  })

  const setSettings = Effect.fn("WakeService.setSettings")(function* (input: {
    readonly commandId: string
    readonly project: ProjectRef
    readonly enabled?: boolean | undefined
    readonly capPerHour?: number | undefined
  }) {
    const caller = yield* Caller
    if (caller.sessionId !== null) return yield* new HumanOnly({ action: "change whether Cello wakes agent sessions", human: human.name })
    const cap = input.capPerHour
    if (cap !== undefined && (!Number.isInteger(cap) || cap < 1 || cap > MAX_CAP)) {
      return yield* new Invalid({ field: "capPerHour", reason: `a whole number from 1 to ${MAX_CAP}` })
    }
    const project = yield* projects.resolve(input.project)
    return yield* commands.write({ commandId: input.commandId, rpc: "wake.setSettings" }, ({ now, emit }) =>
      Effect.gen(function* () {
        const current = yield* settingsRow(project.id)
        const next = { enabled: input.enabled ?? current.enabled, capPerHour: cap ?? current.capPerHour }
        const before: { enabled?: boolean; capPerHour?: number } = {}
        const after: { enabled?: boolean; capPerHour?: number } = {}
        if (next.enabled !== current.enabled) [before.enabled, after.enabled] = [current.enabled, next.enabled]
        if (next.capPerHour !== current.capPerHour) [before.capPerHour, after.capPerHour] = [current.capPerHour, next.capPerHour]
        if (Object.keys(after).length > 0) {
          yield* sql`INSERT INTO wake_settings (project_id, enabled, cap_per_hour, updated_at)
            VALUES (${project.id}, ${next.enabled ? 1 : 0}, ${next.capPerHour}, ${now})
            ON CONFLICT (project_id) DO UPDATE SET enabled = excluded.enabled, cap_per_hour = excluded.cap_per_hour, updated_at = excluded.updated_at`
          yield* emit({ type: "wake.settings_changed", project: project.id, before, after }, { workspaceId: project.workspaceId, projectId: project.id })
        }
        return yield* settingsOf(project.id)
      }))
  })

  const runs = Effect.fn("WakeService.runs")(function* (ref: string) {
    const row = yield* findSession(ref)
    return { session: row.external_id ?? row.id, runs: yield* host.runs(row.id) }
  })

  const watch = Effect.scoped(Effect.gen(function* () {
    const events = yield* log.live
    return yield* events.pipe(
      Stream.runForEach((e) => {
        const action = actionOf(e, human.id)
        if (action === null) return Effect.void
        // One action that can't be judged (a busy database) is logged; the next one is judged as usual.
        return noteAction(action.taskId, action.why).pipe(
          Effect.catchCause((cause) =>
            Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.logError(`Couldn't judge a wake.\n${Cause.pretty(cause)}`)),
        )
      }),
      Effect.andThen(Effect.never),
    )
  }))

  return WakeService.of({ noteAction, wakeNow, cancel, stopRun, settings, setSettings, runs, watch })
})

export const layer = Layer.effect(WakeService, make)

/** The watch as a background fiber for the server's lifetime. */
export const watchLayer = Layer.effectDiscard(Effect.forkScoped(Effect.flatMap(Effect.service(WakeService), (w) => w.watch)))
