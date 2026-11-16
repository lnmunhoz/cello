// The session host (CEL-92): runs agent sessions for Cello, through the agent drivers. Phase ① only
// continues a session (a woken run); later phases add start, send and watch here.
//
// - One run per session at a time: WakeService asks `isRunning` before it starts one.
// - A run is recorded before it starts: its `session_runs` row and `session.run_started` in one
//   command, as the session itself. A retried command id hands back the run it recorded and starts
//   nothing. When it ends, the row and `session.run_ended` are written together.
// - Its output goes to `<dataDir>/runs/<session>/<time>.jsonl`, one JSON value per line: a `cello.run`
//   line, the CLI's own stream-json lines (other lines wrapped as `cello.stdout` / `cello.stderr`), and
//   a `cello.ended` line. Each session keeps its newest KEEP_LOGS logs. Backups copy only the database
//   and assets, so logs stay out of them.
// - Stop is closing the run's scope: the driver kills the process group, the turn ends, and the run is
//   recorded `stopped`. A server shutting down stops every run the same way first; a server that died
//   without that finds the runs still `running` at its next start and records them `stopped`.
import * as fs from "node:fs"
import * as path from "node:path"
import type { CelloMode, RunOutcome, SessionRun, WakeWhy } from "@cello/contract/entities"
import { Caller } from "@cello/contract/rpcs"
import * as Cause from "effect/Cause"
import * as Context from "effect/Context"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as FiberSet from "effect/FiberSet"
import * as Layer from "effect/Layer"
import * as Scope from "effect/Scope"
import * as SqlClient from "effect/sql/SqlClient"
import * as Commands from "../commands/Commands.ts"
import { newId } from "../persistence/ids.ts"
import type { AgentDriver, AgentMode, AgentOutput, TurnEnded } from "./agents/AgentDriver.ts"
import { KEEP_LOGS, WakeConfig } from "./WakeConfig.ts"

/** Who a run runs as: an agent session with its CLI's id and folder. */
export interface RunSession {
  readonly id: string
  readonly actorId: string
  readonly externalId: string
  readonly cwd: string
}

export interface StartRun {
  readonly commandId: string
  readonly session: RunSession
  readonly driver: AgentDriver
  readonly mode: AgentMode
  readonly taskId: string | null
  /** Every task the run is for (a batched wake), `taskId` among them: each counts the run toward its cap. */
  readonly taskIds: ReadonlyArray<string>
  readonly why: WakeWhy
  readonly prompt: string
  /** Where its events go: the task's workspace and project. */
  readonly place: { readonly workspaceId: string; readonly projectId: string | null }
}

export class SessionHost extends Context.Service<SessionHost, {
  /** Records the run and starts it in the background; returns it as recorded (still `running`). */
  readonly start: (input: StartRun) => Effect.Effect<Commands.Written<SessionRun>>
  /** Stops a run going right now and waits for its process to end; false when it isn't going. */
  readonly stop: (runId: string) => Effect.Effect<boolean>
  /** Whether a run of this session is going right now. */
  readonly isRunning: (sessionId: string) => Effect.Effect<boolean>
  /** A session's runs, newest first, with their log files. */
  readonly runs: (sessionId: string) => Effect.Effect<ReadonlyArray<{ readonly run: SessionRun; readonly log: string }>>
  /** A run's log file, when the run exists. */
  readonly logOf: (runId: string) => Effect.Effect<string | null>
}>()("cello/SessionHost") {}

interface RunRow {
  id: string
  session_id: string
  task_id: string | null
  why: WakeWhy
  agent_kind: string
  mode: string
  cello_mode: CelloMode
  pid: number | null
  started_at: number
  ended_at: number | null
  exit_code: number | null
  outcome: RunOutcome
  error: string | null
  log_path: string
}

export const toRun = (r: RunRow): SessionRun => ({
  id: r.id,
  sessionId: r.session_id,
  taskId: r.task_id,
  why: r.why,
  agentKind: r.agent_kind,
  mode: r.mode,
  celloMode: r.cello_mode,
  pid: r.pid,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  exitCode: r.exit_code,
  outcome: r.outcome,
  error: r.error,
})

/** A log's file name: its start time, sortable ("2026-11-16T15-58-12-123Z.jsonl"). */
export const logName = (startedAt: number) => `${new Date(startedAt).toISOString().replaceAll(":", "-").replace(".", "-")}.jsonl`

const LOG_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.jsonl$/

/** A session's log folder name: its CLI's id when that's a plain name, else Cello's id for it. */
const folderOf = (session: RunSession) => (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(session.externalId) ? session.externalId : session.id)

/** One log line: the CLI's JSON lines as they are, anything else wrapped. */
const logLine = (output: AgentOutput) => {
  try {
    JSON.parse(output.line)
    if (output.stream === "stdout" && output.line.trim().startsWith("{")) return output.line
  } catch {
    // Not JSON: wrapped below.
  }
  return JSON.stringify({ type: `cello.${output.stream}`, text: output.line })
}

/** Appends lines to a log; a log that can't be written never stops the run. */
const append = (file: string, line: string) => {
  try {
    fs.appendFileSync(file, `${line}\n`)
  } catch {
    // The log is a nicety.
  }
}

/** Deletes a session's oldest logs beyond KEEP_LOGS; only files named as this host names them. */
const prune = (dir: string) => {
  try {
    const logs = fs.readdirSync(dir).filter((name) => LOG_NAME.test(name)).sort()
    for (const name of logs.slice(0, Math.max(0, logs.length - KEEP_LOGS))) fs.rmSync(path.join(dir, name), { force: true })
  } catch {
    // Nothing to prune.
  }
}

/**
 * The environment a run gets: the host's, without anything that would make it another session or the
 * human (CELLO_SESSION, CELLO_AGENT, CELLO_PERMISSION_MODE) or carry another Claude Code session's
 * identity and tokens (CLAUDE_PID, CLAUDE_CODE_*), then CELLO_WOKEN=1. CLAUDE_CONFIG_DIR stays.
 */
export const runEnv = (env: Readonly<Record<string, string | undefined>>): Record<string, string | undefined> => ({
  ...Object.fromEntries(
    Object.entries(env).filter(([name]) =>
      !["CELLO_SESSION", "CELLO_AGENT", "CELLO_PERMISSION_MODE", "CELLO_WOKEN", "CLAUDE_PID"].includes(name) && !name.startsWith("CLAUDE_CODE_")),
  ),
  CELLO_WOKEN: "1",
})

const OUTCOMES: Record<TurnEnded["outcome"], RunOutcome> = { completed: "completed", failed: "failed", interrupted: "stopped" }

/** A run going right now. */
interface Active {
  readonly run: SessionRun
  readonly session: RunSession
  readonly place: StartRun["place"]
  readonly scope: Scope.Closeable
  /** Done once its process started (or couldn't): only then can closing the scope stop it. */
  readonly started: Deferred.Deferred<void>
  /** Done once its end is recorded. */
  readonly finished: Deferred.Deferred<void>
  /** Set by the first to record its end, so it's recorded once. */
  ending: boolean
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const commands = yield* Commands.Commands
  const config = yield* WakeConfig
  const fibers = yield* FiberSet.make<void, never>()
  const active = new Map<string, Active>()

  const asSession = (session: Pick<RunSession, "id" | "actorId">) => Effect.provideService(Caller, { actorId: session.actorId, sessionId: session.id })

  const rowOf = (id: string) => sql<RunRow>`SELECT * FROM session_runs WHERE id = ${id}`.pipe(Effect.map((rows) => rows[0] ? toRun(rows[0]) : null))

  /**
   * Records how a run ended (row and event, one command) unless that's done, then frees its session
   * whatever happened: a write that fails is logged, and the next start records the run stopped.
   */
  const finish = (entry: Active, ended: TurnEnded): Effect.Effect<void> =>
    entry.ending ? Deferred.await(entry.finished) : Effect.suspend(() => {
      entry.ending = true
      return record(entry, ended).pipe(
        Effect.catchCause((cause) => Effect.logError(`Couldn't record the end of woken run ${entry.run.id}; the next start records it stopped.\n${Cause.pretty(cause)}`)),
        Effect.ensuring(Effect.suspend(() => {
          active.delete(entry.run.sessionId)
          return Deferred.done(entry.finished, Exit.void)
        })),
      )
    })

  const record = (entry: Active, ended: TurnEnded) =>
    Effect.gen(function* () {
      const [row] = yield* sql<{ log_path: string }>`SELECT log_path FROM session_runs WHERE id = ${entry.run.id}`
      const written = yield* commands.write({ commandId: crypto.randomUUID(), rpc: "session.run_ended", receipt: false }, ({ now, emit }) =>
        Effect.gen(function* () {
          const outcome = OUTCOMES[ended.outcome]
          yield* sql`UPDATE session_runs SET ended_at = ${now}, exit_code = ${ended.exitCode}, outcome = ${outcome}, error = ${ended.error}
            WHERE id = ${entry.run.id}`
          const run = (yield* rowOf(entry.run.id))!
          yield* emit({ type: "session.run_ended", run }, entry.place)
          return run
        })).pipe(asSession(entry.session))
      if (row) {
        append(row.log_path, JSON.stringify({ type: "cello.ended", outcome: written.result.outcome, exitCode: ended.exitCode, error: ended.error }))
        prune(path.dirname(row.log_path))
      }
    })

  /** The run itself, in the background: open the session, resume it, wait for the turn, record the end. */
  const runInBackground = (entry: Active, input: StartRun, logPath: string) =>
    Effect.gen(function* () {
      const env = runEnv(yield* config.env)
      const handle = yield* input.driver.open({
        nativeId: input.session.externalId,
        cwd: input.session.cwd,
        mode: input.mode.native,
        env,
        onOutput: (output) => append(logPath, logLine(output)),
        onEvent: () => {},
      }).pipe(Scope.provide(entry.scope))
      const started = yield* Effect.result(handle.resume(input.prompt))
      yield* Deferred.done(entry.started, Exit.void)
      if (started._tag === "Failure") {
        append(logPath, JSON.stringify({ type: "cello.stderr", text: started.failure.message }))
        return yield* finish(entry, { outcome: "failed", exitCode: null, error: started.failure.message })
      }
      if (started.success.pid !== null) yield* sql`UPDATE session_runs SET pid = ${started.success.pid} WHERE id = ${entry.run.id}`.pipe(Effect.orDie)
      const ended = yield* started.success.ended
      yield* Scope.close(entry.scope, Exit.void)
      yield* finish(entry, ended)
    }).pipe(
      // A defect in here must still free the session and record the run as failed.
      Effect.catchCause((cause) =>
        Effect.andThen(
          Effect.andThen(Deferred.done(entry.started, Exit.void), Scope.close(entry.scope, Exit.void)),
          finish(entry, { outcome: "failed", exitCode: null, error: `Cello's run failed: ${String(cause)}`.slice(0, 500) }),
        )),
    )

  const start = Effect.fn("SessionHost.start")(function* (input: StartRun) {
    if (active.has(input.session.id)) return yield* Effect.die(new Error(`A run of session ${input.session.id} is already going`))
    const dir = path.join(config.runsDir, folderOf(input.session))
    let fresh = false
    const written = yield* commands.write({ commandId: input.commandId, rpc: "session.wake" }, ({ now, emit }) =>
      Effect.gen(function* () {
        fresh = true
        const id = newId(now)
        const logPath = path.join(dir, logName(now))
        yield* sql`INSERT INTO session_runs (id, session_id, task_id, task_ids, why, agent_kind, mode, cello_mode, pid, started_at, outcome, log_path)
          VALUES (${id}, ${input.session.id}, ${input.taskId}, ${JSON.stringify(input.taskIds)}, ${input.why}, ${input.driver.kind},
                  ${input.mode.native}, ${input.mode.cello}, NULL, ${now}, 'running', ${logPath})`
        const run = (yield* rowOf(id))!
        yield* emit({ type: "session.run_started", run }, input.place)
        return run
      })).pipe(asSession(input.session), Effect.orDie)
    // A retry of a command that already started its run: nothing more to start.
    if (!fresh) return written
    const run = written.result
    const [row] = yield* sql<{ log_path: string }>`SELECT log_path FROM session_runs WHERE id = ${run.id}`.pipe(Effect.orDie)
    const logPath = row!.log_path
    try {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    } catch {
      // The run goes ahead without a log.
    }
    append(logPath, JSON.stringify({ type: "cello.run", run, prompt: input.prompt }))
    const entry: Active = {
      run,
      session: input.session,
      place: input.place,
      scope: yield* Scope.make(),
      started: yield* Deferred.make<void>(),
      finished: yield* Deferred.make<void>(),
      ending: false,
    }
    active.set(input.session.id, entry)
    yield* FiberSet.run(fibers, runInBackground(entry, input, logPath))
    return written
  })

  /** Closes a run's scope once its process started (the driver then stops it), and waits until its end is recorded. */
  const stopEntry = (entry: Active) =>
    Deferred.await(entry.started).pipe(Effect.andThen(Scope.close(entry.scope, Exit.void)), Effect.andThen(Deferred.await(entry.finished)))

  const stop = Effect.fn("SessionHost.stop")(function* (runId: string) {
    const entry = [...active.values()].find((a) => a.run.id === runId)
    if (!entry || entry.ending) return false
    // The turn then ends interrupted, and the run is recorded stopped.
    yield* stopEntry(entry)
    return true
  })

  const isRunning = (sessionId: string) => Effect.sync(() => active.has(sessionId))

  const runs = Effect.fn("SessionHost.runs")(function* (sessionId: string) {
    const rows = yield* sql<RunRow>`SELECT * FROM session_runs WHERE session_id = ${sessionId} ORDER BY started_at DESC, id DESC`
    return rows.map((r) => ({ run: toRun(r), log: r.log_path }))
  }, Effect.orDie)

  const logOf = Effect.fn("SessionHost.logOf")(function* (runId: string) {
    const [row] = yield* sql<{ log_path: string }>`SELECT log_path FROM session_runs WHERE id = ${runId}`
    return row?.log_path ?? null
  }, Effect.orDie)

  // Runs a previous server left `running` (it died without stopping them) ended with it.
  const leftover = yield* sql<RunRow & { actor_id: string; workspace_id: string | null; project_id: string | null }>`
    SELECT r.*, s.actor_id, p.workspace_id, t.project_id FROM session_runs r
      JOIN agent_sessions s ON s.id = r.session_id
      LEFT JOIN tasks t ON t.id = r.task_id LEFT JOIN projects p ON p.id = t.project_id
    WHERE r.ended_at IS NULL`.pipe(Effect.orDie)
  for (const row of leftover) {
    yield* commands.write({ commandId: crypto.randomUUID(), rpc: "session.run_ended", receipt: false }, ({ now, emit }) =>
      Effect.gen(function* () {
        yield* sql`UPDATE session_runs SET ended_at = ${now}, outcome = 'stopped', error = 'Cello stopped before the run ended' WHERE id = ${row.id}`
        const run = (yield* rowOf(row.id))!
        if (row.workspace_id !== null) yield* emit({ type: "session.run_ended", run }, { workspaceId: row.workspace_id, projectId: row.project_id })
      })).pipe(asSession({ id: row.session_id, actorId: row.actor_id }), Effect.orDie)
  }

  // A stopping server stops every run first, and records each one's end before the database closes.
  yield* Effect.addFinalizer(() =>
    Effect.forEach([...active.values()], stopEntry, {
      concurrency: "unbounded",
      discard: true,
    }))

  return SessionHost.of({ start, stop, isRunning, runs, logOf })
})

export const layer = Layer.effect(SessionHost, make)
