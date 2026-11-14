// Tests 1–2 (server side): identity headers become an agent session, created once and reused;
// "me" or no session is the human.
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as TestClock from "effect/testing/TestClock"
import * as Seed from "../persistence/Seed.ts"
import { services } from "../testing/TestLayers.ts"
import { isGone, SessionService } from "./SessionService.ts"

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

  it.effect("session \"me\" and no session at all both resolve to the human", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      const human = yield* Seed.HumanActor
      expect(yield* sessions.resolve({ ...claude, session: "me" })).toEqual({ actorId: human.id, sessionId: null })
      expect(yield* sessions.resolve({})).toEqual({ actorId: human.id, sessionId: null })
      expect(yield* rows((sql) => sql`SELECT id FROM agent_sessions`)).toEqual([])
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
