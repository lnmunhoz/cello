// Tests 1–2 (server side): identity headers become an agent session, created once and reused;
// "me" or no session is the human.
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as TestClock from "effect/testing/TestClock"
import * as Seed from "../persistence/Seed.ts"
import * as TaskService from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import { endIfUnchanged, isGone, SessionService } from "./SessionService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => effect.pipe(Effect.provide(services())) as Effect.Effect<A, E>

const rows = <T>(query: (sql: SqlClient.SqlClient) => Effect.Effect<ReadonlyArray<T>, unknown>) =>
  Effect.gen(function* () {
    return yield* query(yield* SqlClient.SqlClient)
  }).pipe(Effect.orDie)

const claude = { session: "2fd0505c-417a", client: "Claude Code", pid: 4242, cwd: "/repo", entrypoint: "cli" }

describe("SessionService.resolve", () => {
  it.effect("an agent's identity creates its session and actor once, and reuses them on every call", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      const first = yield* sessions.resolve(claude)
      yield* TestClock.adjust("5 minutes")
      const second = yield* sessions.resolve({ ...claude, cwd: "/repo/sub" })
      expect(second).toEqual(first)
      expect(first.sessionId).not.toBeNull()

      const stored = yield* rows((sql) => sql<{ external_id: string; client_name: string; pid: number; cwd: string; entrypoint: string; started_at: number; last_seen_at: number }>`
        SELECT external_id, client_name, pid, cwd, entrypoint, started_at, last_seen_at FROM agent_sessions`)
      expect(stored).toEqual([{
        external_id: claude.session,
        client_name: "Claude Code",
        pid: 4242,
        cwd: "/repo/sub",
        entrypoint: "cli",
        started_at: 0,
        last_seen_at: 5 * 60_000,
      }])
      const agents = yield* rows((sql) => sql<{ id: string; name: string; client: string }>`
        SELECT id, name, client FROM actors WHERE kind = 'agent'`)
      expect(agents).toEqual([{ id: first.actorId, name: "Claude Code", client: "Claude Code" }])
    })))

  it.effect("a second session of the same client gets its own session under the same actor", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      const one = yield* sessions.resolve(claude)
      const two = yield* sessions.resolve({ ...claude, session: "other-session" })
      expect(two.actorId).toBe(one.actorId)
      expect(two.sessionId).not.toBe(one.sessionId)
    })))

  it.effect("keeps the permission mode its hooks last reported (CEL-92), and Claude Code sessions are of kind claude-code", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      yield* sessions.resolve(claude)
      yield* sessions.resolve({ ...claude, permissionMode: "auto" })
      // A plain `cello` call (no hook) says nothing about the mode: the last one stays.
      yield* sessions.resolve(claude)
      yield* sessions.resolve({ ...claude, session: "codex-1", client: "Agent", permissionMode: "acceptEdits" })
      const stored = yield* rows((sql) => sql<{ external_id: string; permission_mode: string | null; agent_kind: string | null }>`
        SELECT external_id, permission_mode, agent_kind FROM agent_sessions ORDER BY external_id`)
      expect(stored).toEqual([
        { external_id: "2fd0505c-417a", permission_mode: "auto", agent_kind: "claude-code" },
        { external_id: "codex-1", permission_mode: "acceptEdits", agent_kind: null },
      ])
    })))

  it.effect("session \"me\" and no session at all both resolve to the human", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      const human = yield* Seed.HumanActor
      expect(yield* sessions.resolve({ ...claude, session: "me" })).toEqual({ actorId: human.id, sessionId: null })
      expect(yield* sessions.resolve({})).toEqual({ actorId: human.id, sessionId: null })
      expect(yield* rows((sql) => sql`SELECT id FROM agent_sessions`)).toEqual([])
    })))
})

// Presence (CEL-35): boards hear when a session holding a claim checks in or its process exits.
describe("SessionService.checkIn", () => {
  const seenEvents = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{ ts: number; workspace_id: string; project_id: string | null; session_id: string; payload: string }>`
      SELECT ts, workspace_id, project_id, session_id, payload FROM events WHERE type = 'session.seen' ORDER BY seq`
    return rows.map((r) => ({ ...r, session: JSON.parse(r.payload).session as { lastSeenAt: number; endedAt: number | null } }))
  }).pipe(Effect.orDie)

  /** A project with a task the `claude` session has claimed. */
  const claimed = (identity = claude) =>
    Effect.gen(function* () {
      const { project, workspace } = yield* asHuman(setupProject)
      const tasks = yield* TaskService.TaskService
      const { result: task } = yield* asHuman(tasks.create({ commandId: cmd(), projectId: project.id, title: "Work" }))
      yield* asAgent(identity)(tasks.claim({ commandId: cmd(), key: task.key }))
      return { workspace, task }
    })

  it.effect("a session holding a claim checks in: one session.seen in its workspace, then at most one a minute (CEL-76)", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      const { workspace } = yield* claimed()
      const caller = yield* sessions.resolve(claude)
      yield* sessions.checkIn(caller)
      const [first] = yield* seenEvents
      expect(first).toMatchObject({ workspace_id: workspace.id, project_id: null, session_id: caller.sessionId, session: { lastSeenAt: 0, endedAt: null } })

      yield* TestClock.adjust("59 seconds")
      yield* sessions.checkIn(yield* sessions.resolve(claude))
      expect(yield* seenEvents).toHaveLength(1)
      yield* TestClock.adjust("1 second")
      yield* sessions.checkIn(yield* sessions.resolve(claude))
      expect((yield* seenEvents).map((e) => e.session.lastSeenAt)).toEqual([0, 60_000])
    })))

  it.effect("a clock that jumps backwards doesn't stop check-ins", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      yield* claimed()
      yield* TestClock.adjust("1 hour")
      yield* sessions.checkIn(yield* sessions.resolve(claude))
      yield* TestClock.setTime(60_000)
      yield* sessions.checkIn(yield* sessions.resolve(claude))
      expect((yield* seenEvents).map((e) => e.session.lastSeenAt)).toEqual([3_600_000, 60_000])
    })))

  it.effect("writes nothing for a session that holds no claim, or for the human", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      yield* asHuman(setupProject)
      yield* sessions.checkIn(yield* sessions.resolve(claude))
      yield* sessions.checkIn(yield* sessions.resolve({}))
      expect(yield* seenEvents).toEqual([])
    })))

  it.effect("a session whose process exited is marked ended once, and comes back when it calls again", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      const exited = Bun.spawnSync(["true"]).pid
      const gone = { ...claude, pid: exited }
      yield* claimed(gone)
      yield* sessions.checkIn(yield* sessions.resolve(gone))
      yield* TestClock.adjust("10 seconds")
      expect(yield* sessions.sweep).toBe(1)
      expect(yield* sessions.sweep).toBe(0)
      expect((yield* seenEvents).map((e) => e.session.endedAt)).toEqual([null, 10_000])

      // `claude --resume`: same session id, a new pid. It's working again, and boards hear at once.
      yield* TestClock.adjust("5 seconds")
      yield* sessions.checkIn(yield* sessions.resolve({ ...claude, pid: process.pid }))
      expect((yield* seenEvents).at(-1)!.session).toMatchObject({ endedAt: null, lastSeenAt: 15_000 })
    })))

  it.effect("ending a session and telling the boards are one command: if the event can't be written, the session isn't ended", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      const sql = yield* SqlClient.SqlClient
      const exited = Bun.spawnSync(["true"]).pid
      yield* claimed({ ...claude, pid: exited })
      yield* sql`CREATE TRIGGER fail_events BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'disk on fire'); END`.pipe(Effect.orDie)
      expect((yield* Effect.exit(sessions.sweep))._tag).toBe("Failure")
      expect(yield* rows((sql) => sql`SELECT ended_at FROM agent_sessions`)).toEqual([{ ended_at: null }])
    })))

  it.effect("a session that checked in after the sweep read it isn't ended", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      const sql = yield* SqlClient.SqlClient
      yield* claimed()
      const caller = yield* sessions.resolve(claude)
      const [stale] = yield* sessions.byIds([caller.sessionId!])
      yield* TestClock.adjust("5 seconds")
      yield* sessions.resolve(claude)
      expect(yield* endIfUnchanged(sql, stale!, 5_000).pipe(Effect.orDie)).toBe(false)
      expect(yield* rows((sql) => sql`SELECT ended_at FROM agent_sessions`)).toEqual([{ ended_at: null }])
      expect(yield* endIfUnchanged(sql, { ...stale!, lastSeenAt: 5_000 }, 5_000).pipe(Effect.orDie)).toBe(true)
    })))

  it.effect("a live session is left alone", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      yield* claimed({ ...claude, pid: process.pid })
      expect(yield* sessions.sweep).toBe(0)
    })))
})

describe("isGone", () => {
  const session = { pid: null as number | null, lastSeenAt: 0 }
  const TWO_HOURS = 2 * 60 * 60 * 1000

  it("with a pid, the holder is gone exactly when the process has exited", () => {
    expect(isGone({ ...session, pid: process.pid }, TWO_HOURS * 10)).toBe(false)
    const exited = Bun.spawnSync(["true"]).pid
    expect(isGone({ ...session, pid: exited }, 0)).toBe("holder_exited")
  })

  it("without a pid, the holder is gone after 2 quiet hours", () => {
    expect(isGone(session, TWO_HOURS)).toBe(false)
    expect(isGone(session, TWO_HOURS + 1)).toBe("holder_idle")
  })
})
