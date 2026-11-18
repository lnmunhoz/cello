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
import { Caller } from "@cello/contract/rpcs"
import * as Commands from "../commands/Commands.ts"
import { ActivityService } from "./ActivityService.ts"
import { AgentService } from "./AgentService.ts"
import { endGone, endIfUnchanged, isGone, SessionService } from "./SessionService.ts"

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

  it.effect("the terminal app is kept cleaned and capped, in its column and in the identity it came with (CEL-137)", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      const { sessionId } = yield* sessions.resolve({ ...claude, terminal: `Wez\u0007Term${"x".repeat(200)}` })
      const [row] = yield* rows((sql) => sql<{ terminal: string; identity_json: string }>`SELECT terminal, identity_json FROM agent_sessions WHERE id = ${sessionId}`)
      expect(row!.terminal).toBe(`WezTerm${"x".repeat(57)}`)
      expect(JSON.parse(row!.identity_json).terminal).toBe(row!.terminal)
    })))

  it.effect("while a woken run of it goes, its calls don't change where it runs (CEL-137): the session keeps the app it was started in", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      const { sessionId } = yield* sessions.resolve({ ...claude, terminal: "WezTerm" })
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO session_runs (id, session_id, task_id, task_ids, why, agent_kind, mode, cello_mode, pid, started_at, ended_at, outcome, log_path)
        VALUES ('r1', ${sessionId}, NULL, '[]', 'comment', 'claude-code', 'auto', 'auto', NULL, 10, NULL, 'running', '/runs/x.jsonl')`.pipe(Effect.orDie)
      yield* sessions.resolve({ ...claude, entrypoint: "sdk-cli", terminal: "tmux" })
      expect((yield* sessions.byIds([sessionId!]))[0]).toMatchObject({ entrypoint: "cli", terminal: "WezTerm" })
    })))

  it.effect("keeps where it runs (CEL-137): the terminal app it reported, until it reports another; a call that says none keeps it", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      const { sessionId } = yield* sessions.resolve({ ...claude, terminal: "WezTerm" })
      yield* sessions.resolve(claude)
      expect((yield* sessions.byIds([sessionId!]))[0]).toMatchObject({ entrypoint: "cli", terminal: "WezTerm", lastRun: null })
      yield* sessions.resolve({ ...claude, terminal: "iTerm.app" })
      expect((yield* sessions.byIds([sessionId!]))[0]?.terminal).toBe("iTerm.app")
    })))

  it.effect("a session's latest woken run comes with it (CEL-137), going until it ends", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      const { sessionId } = yield* sessions.resolve(claude)
      const sql = yield* SqlClient.SqlClient
      const runRow = (id: string, started: number, ended: number | null) =>
        sql`INSERT INTO session_runs (id, session_id, task_id, task_ids, why, agent_kind, mode, cello_mode, pid, started_at, ended_at, outcome, log_path)
          VALUES (${id}, ${sessionId}, NULL, '[]', 'comment', 'claude-code', 'auto', 'auto', NULL, ${started}, ${ended}, ${ended === null ? "running" : "completed"}, '/runs/x.jsonl')`
      yield* runRow("r1", 10, 20).pipe(Effect.orDie)
      yield* runRow("r2", 30, null).pipe(Effect.orDie)
      expect((yield* sessions.byIds([sessionId!]))[0]?.lastRun).toEqual({ id: "r2", startedAt: 30, endedAt: null })
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

  it.effect("keeps the transcript and current step a hook reported (CEL-106): the session's on the session, a subagent's on the subagent", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      const transcript = "/home/u/.claude/projects/-repo/2fd0505c-417a.jsonl"
      const agentTranscript = "/home/u/.claude/projects/-repo/2fd0505c-417a/subagents/agent-a13b.jsonl"
      yield* sessions.resolve({ ...claude, transcript, step: "Bash · bun run test" })
      yield* TestClock.adjust("1 minute")
      yield* sessions.resolve({ ...claude, agent: "a13b", agentType: "cello-builder", transcript: agentTranscript, step: "Edit · FacetPanel.tsx" })
      // A plain `cello` call (no hook) says neither: the last ones stay.
      yield* TestClock.adjust("1 minute")
      yield* sessions.resolve(claude)
      const session = yield* rows((sql) => sql`SELECT transcript_path, current_step, current_step_at FROM agent_sessions`)
      expect(session).toEqual([{ transcript_path: transcript, current_step: "Bash · bun run test", current_step_at: 0 }])
      const agent = yield* rows((sql) => sql`SELECT transcript_path, current_step, current_step_at FROM session_agents`)
      expect(agent).toEqual([{ transcript_path: agentTranscript, current_step: "Edit · FacetPanel.tsx", current_step_at: 60_000 }])
    })))

  it.effect("masks keys in a current step, and ignores a transcript path that isn't an absolute .jsonl (CEL-106)", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      yield* sessions.resolve({ ...claude, transcript: "relative/s.jsonl", step: "Bash · export API_TOKEN=tok_live_998877 && deploy" })
      yield* sessions.resolve({ ...claude, transcript: "/etc/passwd" })
      yield* sessions.resolve({ ...claude, transcript: "/home/u/.claude/projects/x/\u0007s.jsonl" })
      const [row] = yield* rows((sql) => sql<{ transcript_path: string | null; current_step: string }>`
        SELECT transcript_path, current_step FROM agent_sessions`)
      expect(row!.transcript_path).toBeNull()
      expect(row!.current_step).not.toContain("tok_live_998877")
      expect(row!.current_step).toContain("Bash · export API_TOKEN=")
    })))

  it.effect("keeps a key in a reported step out of every column, the raw identity included (CEL-106)", () =>
    run(Effect.gen(function* () {
      const sessions = yield* SessionService
      const step = "Bash · export API_TOKEN=tok_live_998877abc && deploy"
      yield* sessions.resolve({ ...claude, step })
      yield* sessions.resolve({ ...claude, agent: "a13b", agentType: "cello-builder", step })
      const everything = JSON.stringify([
        yield* rows((sql) => sql`SELECT * FROM agent_sessions`),
        yield* rows((sql) => sql`SELECT * FROM session_agents`),
      ])
      expect(everything).not.toContain("tok_live_998877abc")
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

  // CEL-181: a session whose process is gone leaves its test runs open; the sweep ends them as "ended", with
  // their events, in the command that ends the session.
  describe("a gone session's open test runs (CEL-181)", () => {
    const finishedEvents = Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      const found = yield* sql<{ agent_id: string | null; ts: number; payload: string }>`SELECT agent_id, ts, payload FROM events WHERE type = 'tests.finished' ORDER BY seq`
      return found.map((r) => ({ agentId: r.agent_id, ts: r.ts, ...(JSON.parse(r.payload) as { taskId: string; run: Record<string, any> }) }))
    }).pipe(Effect.orDie)

    const storedRuns = (query: "session" | "agent") =>
      rows((sql) => query === "session"
        ? sql<{ tests_json: string | null }>`SELECT tests_json FROM agent_sessions`
        : sql<{ tests_json: string | null }>`SELECT tests_json FROM session_agents`).pipe(
        Effect.map((r) => r.map((x) => (x.tests_json === null ? [] : (JSON.parse(x.tests_json) as ReadonlyArray<Record<string, any>>)))))

    it.effect("ends its open runs and those of its subagents that haven't stopped, writes their tests.finished, and leaves stopped agents' alone", () =>
      run(Effect.gen(function* () {
        const sessions = yield* SessionService
        const activity = yield* ActivityService
        const agents = yield* AgentService
        const exited = Bun.spawnSync(["true"]).pid
        const gone = { ...claude, pid: exited }
        const builder = { ...gone, agent: "a13bfb89c0de1234", agentType: "cello-builder" }
        const done = { ...gone, agent: "b77d0e11aa22bb33", agentType: "cello-code-reviewer" }
        const { task } = yield* claimed(gone)
        yield* asAgent(gone)(agents.report({ agentId: builder.agent, agentType: "cello-builder", state: "launched", description: task.key }))
        // The session's own foreground run, a builder's background Docker run, and a reviewer's run that already ended.
        yield* asAgent(gone)(activity.report({ kind: "tests-started", toolUseId: "toolu_s", command: "bun run test", cwd: "/repo" }))
        yield* asAgent(builder)(activity.report({ kind: "tests-started", toolUseId: "toolu_b", command: "bun run test:docker:e2e", cwd: "/repo/wt" }))
        yield* asAgent(builder)(activity.report({ kind: "background", id: "blo3xolgq", label: "Bash · bun run test:docker:e2e", toolUseId: "toolu_b", waits: true }))
        yield* asAgent(done)(activity.report({ kind: "tests-started", toolUseId: "toolu_d", command: "bun run test", cwd: "/repo/wt2" }))
        yield* asAgent(done)(activity.report({ kind: "tool-finished", toolUseId: "toolu_d", failed: false }))
        expect((yield* finishedEvents).map((e) => e.run.outcome)).toEqual(["passed"])

        yield* TestClock.adjust("10 seconds")
        expect(yield* sessions.sweep).toBe(1)
        const events = yield* finishedEvents
        expect(events.map((e) => ({ agentId: e.agentId, taskId: e.taskId, outcome: e.run.outcome, endedAt: e.run.endedAt }))).toEqual([
          { agentId: done.agent, taskId: task.id, outcome: "passed", endedAt: 0 },
          { agentId: null, taskId: task.id, outcome: "ended", endedAt: 10_000 },
          { agentId: builder.agent, taskId: task.id, outcome: "ended", endedAt: 10_000 },
        ])
        // On the rows: every run is over, and the reviewer's own outcome stays "passed".
        const all = [...(yield* storedRuns("session")), ...(yield* storedRuns("agent"))].flat()
        expect(all.filter((r) => r.endedAt === null)).toEqual([])
        // A second sweep writes nothing more.
        expect(yield* sessions.sweep).toBe(0)
        expect(yield* finishedEvents).toHaveLength(3)
      })))

    it.effect("the session.seen the sweep sends carries the runs as ended, not as they were before", () =>
      run(Effect.gen(function* () {
        const sessions = yield* SessionService
        const activity = yield* ActivityService
        const gone = { ...claude, pid: Bun.spawnSync(["true"]).pid }
        yield* claimed(gone)
        yield* asAgent(gone)(activity.report({ kind: "tests-started", toolUseId: "toolu_s", command: "bun run test", cwd: "/repo" }))
        yield* TestClock.adjust("10 seconds")
        expect(yield* sessions.sweep).toBe(1)
        const last = (yield* seenEvents).at(-1)!.session as { endedAt: number | null; tests?: { endedAt: number | null; outcome: string | null } | null; runs?: ReadonlyArray<{ endedAt: number | null; outcome: string | null }> }
        expect(last.endedAt).toBe(10_000)
        expect(last.tests).toMatchObject({ endedAt: 10_000, outcome: "ended" })
        expect(last.runs).toMatchObject([{ endedAt: 10_000, outcome: "ended" }])
      })))

    it.effect("a sweep that loses the race (the session checked in since) ends no run and writes nothing", () =>
      run(Effect.gen(function* () {
        const sessions = yield* SessionService
        const activity = yield* ActivityService
        const commands = yield* Commands.Commands
        const sql = yield* SqlClient.SqlClient
        const gone = { ...claude, pid: Bun.spawnSync(["true"]).pid }
        yield* claimed(gone)
        yield* asAgent(gone)(activity.report({ kind: "tests-started", toolUseId: "toolu_s", command: "bun run test", cwd: "/repo" }))
        const caller = yield* sessions.resolve(gone)
        const [stale] = yield* sessions.byIds([caller.sessionId!])
        yield* TestClock.adjust("5 seconds")
        yield* sessions.resolve(gone)
        // The sweep read `stale` before the session called again: its end is called off, with its runs.
        const ended = yield* commands.write({ commandId: cmd(), rpc: "test", receipt: false }, ({ emit }) => endGone(sql, emit, stale!, 5_000)).pipe(
          Effect.provideService(Caller, { actorId: caller.actorId, sessionId: caller.sessionId }),
        )
        expect(ended.result).toBe(false)
        expect(yield* finishedEvents).toEqual([])
        expect((yield* storedRuns("session"))[0]).toMatchObject([{ endedAt: null, outcome: null }])
      })))

    it.effect("ending the runs and the session are one command: if the event can't be written, nothing ends", () =>
      run(Effect.gen(function* () {
        const sessions = yield* SessionService
        const activity = yield* ActivityService
        const sql = yield* SqlClient.SqlClient
        const gone = { ...claude, pid: Bun.spawnSync(["true"]).pid }
        yield* claimed(gone)
        yield* asAgent(gone)(activity.report({ kind: "tests-started", toolUseId: "toolu_s", command: "bun run test", cwd: "/repo" }))
        yield* sql`CREATE TRIGGER fail_finished BEFORE INSERT ON events WHEN NEW.type = 'tests.finished' BEGIN SELECT RAISE(ABORT, 'disk on fire'); END`.pipe(Effect.orDie)
        expect((yield* Effect.exit(sessions.sweep))._tag).toBe("Failure")
        expect(yield* rows((sql) => sql`SELECT ended_at FROM agent_sessions`)).toEqual([{ ended_at: null }])
        expect((yield* storedRuns("session"))[0]).toMatchObject([{ endedAt: null }])
      })))
  })
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
