// CEL-181: which task an agent's test run belongs to, picked when the run starts. A subagent launched on a
// task runs for it; otherwise the session's claim it touched last (its own events and comments on it,
// never a subagent's or Lucas's); no claim, no task.
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as TestClock from "effect/testing/TestClock"
import * as CommentService from "../comment/CommentService.ts"
import * as TaskService from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import { AgentService } from "./AgentService.ts"
import { SessionService } from "./SessionService.ts"
import { runTask } from "./testOutcomes.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => effect.pipe(Effect.provide(services())) as Effect.Effect<A, E>

const orchestrator = { session: "2fd0505c-417a", client: "Claude Code", pid: 4242, cwd: "/repo" }
const builder = { ...orchestrator, agent: "a13bfb89c0de1234", agentType: "cello-builder" }

/** Two tasks in one project, and the ids the picker is given. */
const setup = Effect.gen(function* () {
  const { project } = yield* asHuman(setupProject)
  const tasks = yield* TaskService.TaskService
  const comments = yield* CommentService.CommentService
  const sql = yield* SqlClient.SqlClient
  const make = (title: string) => asHuman(tasks.create({ commandId: cmd(), projectId: project.id, title })).pipe(Effect.map((w) => w.result))
  const [a, b] = [yield* make("A"), yield* make("B")]
  const session = (yield* (yield* SessionService).resolve(orchestrator)).sessionId!
  const claim = (task: { key: string }) => asAgent(orchestrator)(tasks.claim({ commandId: cmd(), key: task.key }))
  const comment = (as: typeof orchestrator | undefined, task: { id: string }) =>
    (as === undefined ? asHuman : asAgent(as))(comments.add({ commandId: cmd(), taskId: task.id, body: "hello" }))
  const pick = (agentId: string | null) => runTask(sql, { sessionId: session, agentId })
  return { a, b, tasks, claim, comment, pick, sql }
})

describe("runTask: which task a test run belongs to (CEL-181)", () => {
  it.effect("a subagent launched on a task runs for it, even when its session claims another", () =>
    run(Effect.gen(function* () {
      const { a, b, claim, pick } = yield* setup
      yield* claim(b)
      yield* asAgent(orchestrator)((yield* AgentService).report({ agentId: builder.agent, agentType: "cello-builder", state: "launched", description: a.key }))
      expect(yield* pick(builder.agent)).toBe(a.id)
      // The session itself has only its claim.
      expect(yield* pick(null)).toBe(b.id)
    })))

  it.effect("a session with one claim gets it; with none, no task", () =>
    run(Effect.gen(function* () {
      const { a, claim, pick } = yield* setup
      expect(yield* pick(null)).toBeNull()
      yield* claim(a)
      expect(yield* pick(null)).toBe(a.id)
      // A subagent launched on no task falls back to the session's claim.
      yield* asAgent(orchestrator)((yield* AgentService).report({ agentId: builder.agent, agentType: "cello-builder", state: "started" }))
      expect(yield* pick(builder.agent)).toBe(a.id)
    })))

  it.effect("with several claims, the one the session itself commented on last; a subagent's or Lucas's later comment doesn't count", () =>
    run(Effect.gen(function* () {
      const { a, b, claim, comment, pick } = yield* setup
      yield* claim(a)
      yield* claim(b)
      yield* TestClock.adjust("1 minute")
      yield* comment(orchestrator, a)
      yield* TestClock.adjust("1 minute")
      yield* comment(orchestrator, b)
      yield* TestClock.adjust("1 minute")
      yield* comment(builder, a)
      yield* TestClock.adjust("1 minute")
      yield* comment(undefined, a)
      expect(yield* pick(null)).toBe(b.id)
      // The session comments on A again: now A.
      yield* TestClock.adjust("1 minute")
      yield* comment(orchestrator, a)
      expect(yield* pick(null)).toBe(a.id)
    })))

  it.effect("with several claims and no comments, the one whose events the session itself wrote last (a move)", () =>
    run(Effect.gen(function* () {
      const { a, b, tasks, claim, pick } = yield* setup
      yield* claim(a)
      yield* claim(b)
      yield* TestClock.adjust("1 minute")
      yield* asAgent(orchestrator)(tasks.setStage({ commandId: cmd(), key: a.key, stage: "building" }))
      expect(yield* pick(null)).toBe(a.id)
      yield* TestClock.adjust("1 minute")
      yield* asAgent(orchestrator)(tasks.setStage({ commandId: cmd(), key: b.key, stage: "building" }))
      expect(yield* pick(null)).toBe(b.id)
    })))

  it.effect("a finished test run on a task is not the session touching it", () =>
    run(Effect.gen(function* () {
      const { a, b, claim, comment, pick, sql } = yield* setup
      yield* claim(a)
      yield* claim(b)
      yield* TestClock.adjust("1 minute")
      yield* comment(orchestrator, a)
      yield* TestClock.adjust("1 minute")
      yield* sql`INSERT INTO events (ts, type, entity_type, entity_id, workspace_id, project_id, command_id, actor_id, session_id, agent_id, schema_version, payload, created_at)
        SELECT 120000, 'tests.finished', 'tests', ${b.id}, workspace_id, project_id, 'x', actor_id, session_id, NULL, 1, '{}', 120000 FROM events WHERE type = 'task.claimed' LIMIT 1`
      expect(yield* pick(null)).toBe(a.id)
    })))

  it.effect("an archived claimed task is never picked", () =>
    run(Effect.gen(function* () {
      const { a, b, tasks, claim, comment, pick } = yield* setup
      yield* claim(a)
      yield* claim(b)
      yield* TestClock.adjust("1 minute")
      yield* comment(orchestrator, b)
      yield* asHuman(tasks.archive({ commandId: cmd(), id: b.id }))
      expect(yield* pick(null)).toBe(a.id)
      yield* asHuman(tasks.archive({ commandId: cmd(), id: a.id }))
      expect(yield* pick(null)).toBeNull()
    })))
})
