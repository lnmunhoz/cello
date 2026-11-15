// CEL-55: subagents under an agent session. Claude Code runs builders and reviewers with their parent's
// session id; the hooks name each one (agent_id, agent_type) and a CLI call can carry it (CELLO_AGENT).
// Each is recorded under its session, credited with what it does, and boards hear it working; claims
// and inbox delivery stay on the session (CEL-15).
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as TestClock from "effect/testing/TestClock"
import * as CommentService from "../comment/CommentService.ts"
import * as EventStore from "../events/EventStore.ts"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import * as TaskService from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import { AgentService } from "./AgentService.ts"
import { SessionService } from "./SessionService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => effect.pipe(Effect.provide(services())) as Effect.Effect<A, E>

const orchestrator = { session: "2fd0505c-417a", client: "Claude Code", pid: 4242, cwd: "/repo" }
const builder = { ...orchestrator, agent: "a13bfb89c0de1234", agentType: "cello-builder" }
const reviewer = { ...orchestrator, agent: "b77d0e11aa22bb33", agentType: "cello-code-reviewer" }

const agentRows = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<{ agent_id: string; agent_type: string | null; task_id: string | null; last_seen_at: number; ended_at: number | null }>`
    SELECT agent_id, agent_type, task_id, last_seen_at, ended_at FROM session_agents ORDER BY agent_id`
}).pipe(Effect.orDie)

const agentSeen = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ workspace_id: string; project_id: string | null; agent_id: string | null; payload: string }>`
    SELECT workspace_id, project_id, agent_id, payload FROM events WHERE type = 'agent.seen' ORDER BY seq`
  return rows.map((r) => ({ ...r, agent: JSON.parse(r.payload).agent as { agentId: string; taskId: string | null; endedAt: number | null; lastSeenAt: number } }))
}).pipe(Effect.orDie)

/** A project with two tasks Lucas made, and the orchestrator session holding a claim on the first. */
const board = Effect.gen(function* () {
  const { project, workspace } = yield* asHuman(setupProject)
  const tasks = yield* TaskService.TaskService
  const { result: first } = yield* asHuman(tasks.create({ commandId: cmd(), projectId: project.id, title: "Agents on cards" }))
  const { result: second } = yield* asHuman(tasks.create({ commandId: cmd(), projectId: project.id, title: "Sidebar list" }))
  yield* asAgent(orchestrator)(tasks.claim({ commandId: cmd(), key: first.key }))
  return { workspace, project, first, second }
})

describe("a CLI call carrying an agent identity", () => {
  it.effect("is credited to that agent: its comment, its event and the task's last change name it, under the session", () =>
    run(Effect.gen(function* () {
      const { first } = yield* board
      const comments = yield* CommentService.CommentService
      const caller = yield* (yield* SessionService).resolve(builder)
      const session = (yield* (yield* SessionService).resolve(orchestrator)).sessionId
      expect(caller).toMatchObject({ sessionId: session, agentId: builder.agent })

      const { result: comment } = yield* asAgent(builder)(comments.add({ commandId: cmd(), taskId: first.id, body: "Built, tests pass" }))
      expect(comment).toMatchObject({ sessionId: session, agentId: builder.agent })
      const task = yield* (yield* TaskService.TaskService).byKey(first.key)
      expect(task).toMatchObject({ updatedBySessionId: session, updatedByAgentId: builder.agent })
      const [added] = yield* (yield* EventStore.EventStore).history(comment.id)
      expect(added).toMatchObject({ type: "comment.added", sessionId: session, agentId: builder.agent })
      // Older events and the session's own carry null.
      const [created] = yield* (yield* EventStore.EventStore).history(first.id)
      expect(created).toMatchObject({ type: "task.created", sessionId: null, agentId: null })

      // First sight records it, with its type.
      expect(yield* agentRows).toEqual([{ agent_id: builder.agent, agent_type: "cello-builder", task_id: null, last_seen_at: 0, ended_at: null }])
    })))

  it.effect("claims stay on the session: an agent's claim is the session's, and the session's own call keeps holding it", () =>
    run(Effect.gen(function* () {
      const { second } = yield* board
      const tasks = yield* TaskService.TaskService
      const { result: claimed } = yield* asAgent(builder)(tasks.claim({ commandId: cmd(), key: second.key }))
      const session = (yield* (yield* SessionService).resolve(orchestrator)).sessionId
      expect(claimed).toMatchObject({ assigneeSessionId: session, updatedByAgentId: builder.agent })
      // The orchestrator itself (no agent) still holds it: it can set the stage, as the holder.
      const { result: staged } = yield* asAgent(orchestrator)(tasks.setStage({ commandId: cmd(), key: second.key, stage: "review" }))
      expect(staged).toMatchObject({ assigneeSessionId: session, stage: "review", updatedByAgentId: null })
      const mine = yield* asAgent(reviewer)(tasks.byKey(second.key))
      expect(mine.assigneeSessionId).toBe(session)
    })))
})

describe("AgentService.report and checkIn: the hooks", () => {
  it.effect("a launch links the agent to the first task its description names, else its prompt; boards hear it in that task's workspace", () =>
    run(Effect.gen(function* () {
      const { workspace, first, second } = yield* board
      const agents = yield* AgentService
      yield* asAgent(orchestrator)(agents.report({
        agentId: builder.agent,
        agentType: "cello-builder",
        state: "launched",
        description: `${second.key} sidebar list`,
        prompt: `Build ${first.key}`,
      }))
      yield* asAgent(orchestrator)(agents.report({ agentId: reviewer.agent, agentType: "cello-code-reviewer", state: "launched", description: "Review the branch", prompt: `Review NOPE-9 then ${first.key}` }))
      expect((yield* agentRows).map((a) => [a.agent_id, a.task_id])).toEqual([[builder.agent, second.id], [reviewer.agent, first.id]])

      const seen = yield* agentSeen
      expect(seen.map((e) => [e.workspace_id, e.project_id, e.agent.agentId, e.agent.taskId])).toEqual([
        [workspace.id, null, builder.agent, second.id],
        [workspace.id, null, reviewer.agent, first.id],
      ])
    })))

  it.effect("a subagent's tool calls check it in under its session: one agent.seen, then at most one every 2 minutes", () =>
    run(Effect.gen(function* () {
      const { first } = yield* board
      const agents = yield* AgentService
      const sessions = yield* SessionService
      yield* asAgent(orchestrator)(agents.report({ agentId: builder.agent, agentType: "cello-builder", state: "launched", description: first.key }))
      const before = (yield* agentSeen).length

      yield* TestClock.adjust("30 seconds")
      yield* agents.checkIn(yield* sessions.resolve(builder))
      yield* TestClock.adjust("89 seconds")
      yield* agents.checkIn(yield* sessions.resolve(builder))
      expect(yield* agentSeen).toHaveLength(before)
      yield* TestClock.adjust("1 second")
      yield* agents.checkIn(yield* sessions.resolve(builder))
      const seen = yield* agentSeen
      expect(seen).toHaveLength(before + 1)
      expect(seen.at(-1)).toMatchObject({ agent_id: builder.agent, agent: { agentId: builder.agent, lastSeenAt: 120_000, taskId: first.id } })
      expect((yield* agentRows)[0]?.last_seen_at).toBe(120_000)
    })))

  it.effect("two agents of one session both show: each its own row, both in the snapshot, with their session", () =>
    run(Effect.gen(function* () {
      const { first, second } = yield* board
      const agents = yield* AgentService
      const sessions = yield* SessionService
      yield* asAgent(orchestrator)(agents.report({ agentId: builder.agent, agentType: "cello-builder", state: "launched", description: first.key }))
      yield* asAgent(orchestrator)(agents.report({ agentId: reviewer.agent, agentType: "cello-code-reviewer", state: "launched", description: second.key }))
      yield* agents.checkIn(yield* sessions.resolve(builder))
      yield* agents.checkIn(yield* sessions.resolve(reviewer))

      const snapshot = yield* (yield* SnapshotService.SnapshotService).get()
      const session = (yield* sessions.resolve(orchestrator)).sessionId
      expect(snapshot.agents.map((a) => [a.sessionId, a.agentId, a.agentType, a.taskId])).toEqual([
        [session, builder.agent, "cello-builder", first.id],
        [session, reviewer.agent, "cello-code-reviewer", second.id],
      ])
      expect(snapshot.sessions.map((s) => s.id)).toContain(session)
    })))

  it.effect("stopped ends it, and a resumed agent (started again, or any call) is back", () =>
    run(Effect.gen(function* () {
      const { first } = yield* board
      const agents = yield* AgentService
      const sessions = yield* SessionService
      yield* asAgent(orchestrator)(agents.report({ agentId: builder.agent, agentType: "cello-builder", state: "launched", description: first.key }))
      yield* TestClock.adjust("10 seconds")
      const stopped = yield* asAgent(orchestrator)(agents.report({ agentId: builder.agent, agentType: "cello-builder", state: "stopped" }))
      expect(stopped).toMatchObject({ endedAt: 10_000 })
      expect((yield* agentSeen).at(-1)?.agent.endedAt).toBe(10_000)

      // Resumed through SendMessage: SubagentStart fires again; boards hear it at once, throttle or not.
      yield* TestClock.adjust("5 seconds")
      yield* asAgent(orchestrator)(agents.report({ agentId: builder.agent, agentType: "cello-builder", state: "started" }))
      expect((yield* agentSeen).at(-1)?.agent).toMatchObject({ endedAt: null, lastSeenAt: 15_000, taskId: first.id })

      yield* asAgent(orchestrator)(agents.report({ agentId: builder.agent, agentType: "cello-builder", state: "stopped" }))
      yield* agents.checkIn(yield* sessions.resolve(builder))
      expect((yield* agentRows)[0]?.ended_at).toBeNull()
    })))

  it.effect("a stop for an agent it never saw (Claude Code's own helpers) records nothing; the human records nothing", () =>
    run(Effect.gen(function* () {
      yield* board
      const agents = yield* AgentService
      expect(yield* asAgent(orchestrator)(agents.report({ agentId: "internal-1", agentType: null, state: "stopped" }))).toBeNull()
      expect(yield* asHuman(agents.report({ agentId: builder.agent, agentType: "cello-builder", state: "started" }))).toBeNull()
      expect(yield* agentRows).toEqual([])
    })))

  it.effect("an agent with no task is heard where its session holds claims; with neither, nobody is told", () =>
    run(Effect.gen(function* () {
      const { workspace } = yield* board
      const agents = yield* AgentService
      yield* asAgent(orchestrator)(agents.report({ agentId: builder.agent, agentType: "general-purpose", state: "started" }))
      expect((yield* agentSeen).map((e) => e.workspace_id)).toEqual([workspace.id])

      const loner = { session: "9c9c9c9c-lonely", client: "Claude Code", agent: "c0ffee", agentType: "Explore" }
      yield* asAgent(loner)(agents.report({ agentId: "c0ffee", agentType: "Explore", state: "started" }))
      expect(yield* agentSeen).toHaveLength(1)
      expect((yield* agentRows).map((a) => a.agent_id)).toEqual([builder.agent, "c0ffee"])
    })))

  // A foreground subagent's launch reaches the board after it finished: the parent's PostToolUse on the
  // Agent tool fires when the tool returns. It must not bring a finished agent back.
  it.effect("a launch that arrives after the agent stopped links its task but leaves it ended", () =>
    run(Effect.gen(function* () {
      const { first } = yield* board
      const agents = yield* AgentService
      yield* asAgent(orchestrator)(agents.report({ agentId: builder.agent, agentType: "cello-builder", state: "started" }))
      yield* TestClock.adjust("10 seconds")
      yield* asAgent(orchestrator)(agents.report({ agentId: builder.agent, agentType: "cello-builder", state: "stopped" }))
      yield* TestClock.adjust("1 second")
      const launched = yield* asAgent(orchestrator)(agents.report({ agentId: builder.agent, agentType: "cello-builder", state: "launched", description: first.key }))
      expect(launched).toMatchObject({ taskId: first.id, endedAt: 10_000, lastSeenAt: 0 })
      expect((yield* agentSeen).at(-1)?.agent).toMatchObject({ taskId: first.id, endedAt: 10_000 })
    })))

  it.effect("a launch names the task the session holds when the prompt names several; else the first one", () =>
    run(Effect.gen(function* () {
      const { project, first } = yield* board
      const tasks = yield* TaskService.TaskService
      const { result: other } = yield* asHuman(tasks.create({ commandId: cmd(), projectId: project.id, title: "Not ours" }))
      const agents = yield* AgentService
      // The orchestrator holds `first` only; the prompt mentions `other` first.
      yield* asAgent(orchestrator)(agents.report({ agentId: builder.agent, agentType: "cello-builder", state: "launched", prompt: `After ${other.key}, build ${first.key}` }))
      yield* asAgent(orchestrator)(agents.report({ agentId: reviewer.agent, agentType: "cello-code-reviewer", state: "launched", prompt: `Look at ${other.key}` }))
      expect((yield* agentRows).map((a) => [a.agent_id, a.task_id])).toEqual([[builder.agent, first.id], [reviewer.agent, other.id]])
    })))

  it.effect("the snapshot leaves out agents that finished, except the one that last changed a task", () =>
    run(Effect.gen(function* () {
      const { first } = yield* board
      const agents = yield* AgentService
      yield* asAgent(orchestrator)(agents.report({ agentId: builder.agent, agentType: "cello-builder", state: "launched", description: first.key }))
      yield* asAgent(orchestrator)(agents.report({ agentId: reviewer.agent, agentType: "cello-code-reviewer", state: "launched", description: first.key }))
      yield* asAgent(reviewer)((yield* TaskService.TaskService).setStage({ commandId: cmd(), key: first.key, stage: "review" }))
      for (const agentId of [builder.agent, reviewer.agent]) {
        yield* asAgent(orchestrator)(agents.report({ agentId, agentType: null, state: "stopped" }))
      }
      const snapshot = yield* (yield* SnapshotService.SnapshotService).get()
      expect(snapshot.agents.map((a) => a.agentId)).toEqual([reviewer.agent])
    })))

  it.effect("an agent id or type with control characters is stored without them", () =>
    run(Effect.gen(function* () {
      yield* board
      const agents = yield* AgentService
      const agent = yield* asAgent(orchestrator)(agents.report({ agentId: "a1\u0000b2", agentType: "cello-\u001b[31mbuilder\n", state: "started" }))
      expect(agent).toMatchObject({ agentId: "a1b2", agentType: "cello-[31mbuilder" })
    })))
})
