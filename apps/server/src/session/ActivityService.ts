// What a hook saw the caller do besides checking in (`activity.report`), and a test runner's progress
// (`tests.progress`): the session itself, or with `x-cello-agent` one of its subagents (CEL-55). The
// rules are ./activity.ts; this keeps them on the caller's row and tells boards when what shows changes.
//
// - `background` (CEL-133): a tool call started background work (a shell run with run_in_background, a
//   Monitor). It's remembered, so a later stop can tell a subagent waiting on its own work from one that
//   finished (AgentService.report). A test run that call started runs on in the background.
// - Test runs (CEL-134): a Bash call about to run a test command starts one (`tests-started`), its end
//   ends a foreground one (`tool-finished`), and so does the turn that leaves it behind (`turn-ended`, the
//   session's Stop; a subagent's stop is AgentService.report). The runner's reports say where it is.
import type { TestProgress } from "@cello/contract/entities"
import type { ActivityReport } from "@cello/contract/rpcs"
import { Caller } from "@cello/contract/rpcs"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import {
  type BackgroundWork,
  parseBackground,
  parseRuns,
  pickRun,
  stored,
  type StoredTestRun,
  testsBackgrounded,
  testsProgressed,
  testsStarted,
  testsToolFinished,
  testsTurnEnded,
  withBackground,
  withRun,
} from "./activity.ts"
import { AgentService } from "./AgentService.ts"
import { cleanAgentText, cleanStep, CONTROL_CHARACTERS, MAX_TRANSCRIPT_PATH, SessionService } from "./SessionService.ts"

export class ActivityService extends Context.Service<ActivityService, {
  /** What a hook saw the caller do. The human, or a call without a session, changes nothing. */
  readonly report: (report: ActivityReport) => Effect.Effect<void, never, Caller>
  /**
   * A test runner's progress, from the caller's session (its shell can't say which subagent): the
   * running run started from `cwd`, else from the deepest folder holding it or inside it, else the
   * session's only running one, takes it (activity.ts pickRun). Whether one did.
   */
  readonly progress: (cwd: string, progress: TestProgress) => Effect.Effect<{ readonly matched: boolean }, never, Caller>
}>()("cello/ActivityService") {}

/** Boards hear a run's progress at most this often, unless a test failed or the run ended. */
export const PROGRESS_EVERY_MS = 2000

/** How many of a run's failures are kept: the newest. */
export const MAX_FAILURES = 20

/** Whose row: the session's own, or one of its subagents'. */
interface Actor {
  readonly sessionId: string
  readonly agentId: string | null
}

interface ActivityRow {
  readonly background_json: string | null
  readonly tests_json: string | null
}

const count = (n: number) => (Number.isFinite(n) && n > 0 ? Math.floor(n) : 0)

/** A folder as kept: an absolute path without control characters, not too long; else none. */
const cleanFolder = (value: string | null | undefined): string | null => {
  const text = value?.trim()
  return text && text.startsWith("/") && text.length <= MAX_TRANSCRIPT_PATH && !new RegExp(CONTROL_CHARACTERS.source).test(text) ? text : null
}

/** The runner's report as kept: counts whole and not negative, lines cleaned and masked, the newest failures, an absolute folder. */
const cleanProgress = (p: TestProgress): TestProgress => ({
  stage: cleanStep(p.stage),
  passed: count(p.passed),
  failed: count(p.failed),
  skipped: count(p.skipped),
  total: p.total === null ? null : count(p.total),
  current: cleanStep(p.current),
  failures: p.failures.flatMap((f) => cleanStep(f) ?? []).slice(-MAX_FAILURES),
  done: p.done,
  outcome: p.outcome,
  folder: cleanFolder(p.folder),
})

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const agents = yield* AgentService
  const sessions = yield* SessionService
  /** When boards last heard each actor's run move, with its failures then. In memory: a restart tells again. */
  const heard = new Map<string, { readonly at: number; readonly failed: number }>()

  const actorOf = (caller: Caller["Service"]): Actor | null =>
    caller.sessionId === null ? null : { sessionId: caller.sessionId, agentId: caller.agentId ?? null }

  const read = (actor: Actor) =>
    (actor.agentId
      ? sql<ActivityRow>`SELECT background_json, tests_json FROM session_agents WHERE session_id = ${actor.sessionId} AND agent_id = ${actor.agentId}`
      : sql<ActivityRow>`SELECT background_json, tests_json FROM agent_sessions WHERE id = ${actor.sessionId}`).pipe(Effect.map((rows) => rows[0] ?? null))

  const write = (actor: Actor, row: ActivityRow, seenAt: number | null = null) =>
    actor.agentId
      ? sql`UPDATE session_agents SET background_json = ${row.background_json}, tests_json = ${row.tests_json},
          last_seen_at = COALESCE(${seenAt}, last_seen_at)
          WHERE session_id = ${actor.sessionId} AND agent_id = ${actor.agentId}`
      : sql`UPDATE agent_sessions SET background_json = ${row.background_json}, tests_json = ${row.tests_json},
          last_seen_at = COALESCE(${seenAt}, last_seen_at)
          WHERE id = ${actor.sessionId}`

  const announce = (actor: Actor) =>
    actor.agentId ? agents.announce({ sessionId: actor.sessionId, agentId: actor.agentId }) : sessions.announce(actor.sessionId)

  /**
   * The actor's background work and test runs, changed by `change`, in one transaction; boards hear it
   * when a run changed. Nothing for a row that doesn't exist.
   */
  const change = (
    actor: Actor,
    change: (background: ReadonlyArray<BackgroundWork>, runs: ReadonlyArray<StoredTestRun>, now: number) => {
      readonly background: ReadonlyArray<BackgroundWork>
      readonly runs: ReadonlyArray<StoredTestRun>
    },
  ) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis
      const moved = yield* sql.withTransaction(Effect.gen(function* () {
        const row = yield* read(actor)
        if (row === null) return false
        const runs = parseRuns(row.tests_json)
        const next = change(parseBackground(row.background_json), runs, now)
        yield* write(actor, { background_json: stored(next.background), tests_json: stored(next.runs) })
        return next.runs.length !== runs.length || next.runs.some((run, i) => run !== runs[i])
      }))
      if (moved) {
        heard.delete(`${actor.sessionId} ${actor.agentId ?? ""}`)
        yield* announce(actor)
      }
    })

  const report = Effect.fn("ActivityService.report")(function* (input: ActivityReport) {
    const actor = actorOf(yield* Caller)
    if (actor === null) return
    switch (input.kind) {
      case "background": {
        const id = cleanAgentText(input.id)
        if (id === null) return
        const toolUseId = cleanAgentText(input.toolUseId)
        const work: BackgroundWork = { id, label: cleanStep(input.label) ?? "Background work", toolUseId, waits: input.waits }
        return yield* change(actor, (background, runs) => ({
          background: withBackground(background, work),
          runs: runs.map((run) => testsBackgrounded(run, toolUseId, id)),
        }))
      }
      case "tests-started": {
        const runId = cleanAgentText(input.toolUseId)
        const command = cleanStep(input.command)
        if (runId === null || command === null) return
        // Beside its live runs (a background Docker run goes on), never in place of them.
        return yield* change(actor, (background, runs, now) => ({
          background,
          runs: withRun(runs, testsStarted({ runId, command, cwd: cleanFolder(input.cwd), now })),
        }))
      }
      case "tool-finished": {
        const toolUseId = cleanAgentText(input.toolUseId)
        if (toolUseId === null) return
        return yield* change(actor, (background, runs, now) => ({ background, runs: runs.map((run) => testsToolFinished(run, toolUseId, input.failed, now)) }))
      }
      case "turn-ended": {
        const running = input.running
        return yield* change(actor, (background, runs, now) => ({
          // What it started that's no longer running is done; not knowing, it's all kept.
          background: running === undefined ? background : background.filter((w) => running.includes(w.id)),
          runs: runs.map((run) => testsTurnEnded(run, running, now)),
        }))
      }
    }
  }, Effect.orDie)

  const progress = Effect.fn("ActivityService.progress")(function* (cwd: string, input: TestProgress) {
    const caller = yield* Caller
    if (caller.sessionId === null) return { matched: false }
    const sessionId = caller.sessionId
    const now = yield* Clock.currentTimeMillis
    const cleaned = cleanProgress(input)
    // Read, pick and write in one transaction, so two reports (or a report and a hook) can't interleave.
    const found = yield* sql.withTransaction(Effect.gen(function* () {
      const rows = yield* sql<{ agent_id: string | null; tests_json: string | null }>`
        SELECT NULL AS agent_id, tests_json FROM agent_sessions WHERE id = ${sessionId} AND tests_json IS NOT NULL
        UNION ALL
        SELECT agent_id, tests_json FROM session_agents WHERE session_id = ${sessionId} AND tests_json IS NOT NULL`
      const running = rows.flatMap((r) =>
        parseRuns(r.tests_json).filter((run) => run.endedAt === null).map((run) => ({ actor: { sessionId, agentId: r.agent_id }, run }))
      )
      const picked = pickRun(running, cwd)
      if (picked === undefined) return undefined
      const row = yield* read(picked.actor)
      if (row === null) return undefined
      const next = testsProgressed(picked.run, cleaned, now)
      const runs = parseRuns(row.tests_json).map((run) => (run.runId === picked.run.runId ? next : run))
      // A runner reporting is its agent at work: seen now.
      yield* write(picked.actor, { background_json: row.background_json, tests_json: stored(runs) }, now)
      return { actor: picked.actor, ended: next.endedAt !== null }
    }))
    if (found === undefined) return { matched: false }
    const key = `${sessionId} ${found.actor.agentId ?? ""}`
    const last = heard.get(key)
    const failed = cleaned.failed
    if (last === undefined || found.ended || failed !== last.failed || now < last.at || now - last.at >= PROGRESS_EVERY_MS) {
      heard.set(key, { at: now, failed })
      yield* announce(found.actor)
    }
    return { matched: true }
  }, Effect.orDie)

  return ActivityService.of({ report, progress })
})

export const layer = Layer.effect(ActivityService, make)
