// CEL-134: an agent running tests. A Bash call that runs a test command starts a run on the agent that
// made it; the test runner's reports, which carry only the session, find it by folder; boards hear it
// start, move and end.
import type { TestProgress } from "@cello/contract/entities"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as SqlClient from "effect/sql/SqlClient"
import * as TestClock from "effect/testing/TestClock"
import * as TaskService from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import { ActivityService, PROGRESS_EVERY_MS } from "./ActivityService.ts"
import { AgentService } from "./AgentService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => effect.pipe(Effect.provide(services())) as Effect.Effect<A, E>

const orchestrator = { session: "2fd0505c-417a", client: "Claude Code", pid: 4242, cwd: "/repo" }
const builder = { ...orchestrator, agent: "a13bfb89c0de1234", agentType: "cello-builder" }
const reviewer = { ...orchestrator, agent: "b77d0e11aa22bb33", agentType: "cello-code-reviewer" }

const seen = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ type: string; payload: string }>`SELECT type, payload FROM events WHERE type IN ('agent.seen', 'session.seen') ORDER BY seq`
  return rows.map((r) => {
    const payload = JSON.parse(r.payload)
    return { type: r.type, who: payload.agent?.agentId ?? payload.session?.id, tests: payload.agent?.tests ?? payload.session?.tests ?? null, lastSeenAt: (payload.agent ?? payload.session).lastSeenAt }
  })
}).pipe(Effect.orDie)

/** A task the orchestrator claimed, a builder launched on it, and a reviewer. */
const board = Effect.gen(function* () {
  const { project } = yield* asHuman(setupProject)
  const tasks = yield* TaskService.TaskService
  const { result: task } = yield* asHuman(tasks.create({ commandId: cmd(), projectId: project.id, title: "Agents on cards" }))
  yield* asAgent(orchestrator)(tasks.claim({ commandId: cmd(), key: task.key }))
  const agents = yield* AgentService
  yield* asAgent(orchestrator)(agents.report({ agentId: builder.agent, agentType: "cello-builder", state: "launched", description: task.key }))
  yield* asAgent(orchestrator)(agents.report({ agentId: reviewer.agent, agentType: "cello-code-reviewer", state: "launched", description: task.key }))
  return { task, activity: yield* ActivityService }
})

const progress = (extra: Partial<TestProgress> = {}): TestProgress => ({
  stage: "web-e2e", passed: 0, failed: 0, skipped: 0, total: 13, current: null, failures: [], done: false, outcome: null, folder: null, ...extra,
})

describe("ActivityService: test runs (CEL-134)", () => {
  it.effect("a foreground run starts on the agent that ran it and ends with its call: passed, or failed when the call failed", () =>
    run(Effect.gen(function* () {
      const { activity } = yield* board
      yield* TestClock.adjust("1 second")
      yield* asAgent(builder)(activity.report({ kind: "tests-started", toolUseId: "toolu_1", command: "bun run test -- apps/server", cwd: "/repo/wt" }))
      expect((yield* seen).at(-1)).toMatchObject({
        type: "agent.seen", who: builder.agent,
        tests: { label: "unit tests", command: "bun run test -- apps/server", startedAt: 1000, endedAt: null, background: false, progress: null },
      })
      expect((yield* seen).at(-1)?.tests).not.toHaveProperty("runId")

      yield* TestClock.adjust("80 seconds")
      // Another call's end changes nothing; its own ends it.
      const before = (yield* seen).length
      yield* asAgent(builder)(activity.report({ kind: "tool-finished", toolUseId: "toolu_other", failed: false }))
      expect(yield* seen).toHaveLength(before)
      yield* asAgent(builder)(activity.report({ kind: "tool-finished", toolUseId: "toolu_1", failed: true }))
      expect((yield* seen).at(-1)?.tests).toMatchObject({ endedAt: 81_000, outcome: "failed" })
    })))

  it.effect("a background run takes the runner's reports, found by folder; a failure is heard at once, other moves at most every 2 s; the last report ends it", () =>
    run(Effect.gen(function* () {
      const { activity } = yield* board
      const command = "CELLO_E2E_REVIEW=1 bun run test:docker:e2e -- e2e/agents-page.spec.ts"
      // Two agents run tests in their own worktrees.
      yield* asAgent(builder)(activity.report({ kind: "tests-started", toolUseId: "toolu_b", command, cwd: "/repo/.claude/worktrees/agent-a13b" }))
      yield* asAgent(builder)(activity.report({ kind: "background", id: "blo3xolgq", label: `Bash · ${command}`, toolUseId: "toolu_b" }))
      yield* asAgent(reviewer)(activity.report({ kind: "tests-started", toolUseId: "toolu_r", command: "bun run test", cwd: "/repo/.claude/worktrees/agent-b77d" }))
      expect((yield* seen).filter((e) => e.who === builder.agent).at(-1)?.tests).toMatchObject({ label: "web e2e", background: true, endedAt: null })

      // The runner, in the builder's worktree, reports as the session (its shell can't name the agent).
      yield* TestClock.adjust("30 seconds")
      const runner = asAgent(orchestrator)
      expect(yield* runner(activity.progress("/repo/.claude/worktrees/agent-a13b", progress({ passed: 1, current: "e2e/agents-page.spec.ts" })))).toEqual({ matched: true })
      const first = (yield* seen).at(-1)!
      expect(first).toMatchObject({ who: builder.agent, lastSeenAt: 30_000, tests: { progress: { passed: 1, total: 13 } } })

      const count = (yield* seen).length
      yield* TestClock.adjust(PROGRESS_EVERY_MS - 1)
      yield* runner(activity.progress("/repo/.claude/worktrees/agent-a13b", progress({ passed: 2 })))
      expect(yield* seen).toHaveLength(count)
      yield* runner(activity.progress("/repo/.claude/worktrees/agent-a13b", progress({ passed: 2, failed: 1, failures: ["e2e/agents-page.spec.ts:40 › lists agents"] })))
      expect((yield* seen).at(-1)?.tests).toMatchObject({ progress: { passed: 2, failed: 1, failures: ["e2e/agents-page.spec.ts:40 › lists agents"] } })

      yield* TestClock.adjust("1 minute")
      const folder = "/repo/.claude/worktrees/agent-a13b/test-results/docker/2026-11-17_020000-e2e-1"
      yield* runner(activity.progress("/repo/.claude/worktrees/agent-a13b", progress({ passed: 12, failed: 1, done: true, outcome: "failed", folder })))
      expect((yield* seen).at(-1)?.tests).toMatchObject({ endedAt: 30_000 + PROGRESS_EVERY_MS - 1 + 60_000, outcome: "failed", progress: { folder } })
      // The reviewer's run never took the builder's reports.
      const sql = yield* SqlClient.SqlClient
      const [reviewerRow] = yield* sql<{ tests_json: string }>`SELECT tests_json FROM session_agents WHERE agent_id = ${reviewer.agent}`
      expect(JSON.parse(reviewerRow!.tests_json).progress).toBeNull()
    })))

  it.effect("a report no running run takes is dropped: from another folder with two runs, after the run ended, from the human", () =>
    run(Effect.gen(function* () {
      const { activity } = yield* board
      const runner = asAgent(orchestrator)
      expect(yield* runner(activity.progress("/repo", progress()))).toEqual({ matched: false })
      yield* asAgent(builder)(activity.report({ kind: "tests-started", toolUseId: "t1", command: "bun run test", cwd: "/repo/wt-a" }))
      // The session's only running run takes a report from anywhere in the session.
      expect(yield* runner(activity.progress("/elsewhere", progress()))).toEqual({ matched: true })
      yield* asAgent(reviewer)(activity.report({ kind: "tests-started", toolUseId: "t2", command: "bun run test", cwd: "/repo/wt-b" }))
      expect(yield* runner(activity.progress("/elsewhere", progress()))).toEqual({ matched: false })
      expect(yield* runner(activity.progress("/repo/wt-b", progress()))).toEqual({ matched: true })
      expect(yield* asHuman(activity.progress("/repo/wt-b", progress()))).toEqual({ matched: false })
    })))

  it.effect("the session's own run: started by its call, heard as session.seen; the turn that leaves a foreground run behind ends it", () =>
    run(Effect.gen(function* () {
      const { activity } = yield* board
      yield* asAgent(orchestrator)(activity.report({ kind: "tests-started", toolUseId: "toolu_s", command: "bun run test:docker", cwd: "/repo" }))
      expect((yield* seen).at(-1)).toMatchObject({ type: "session.seen", tests: { label: "Docker tests", endedAt: null } })
      yield* TestClock.adjust("5 seconds")
      yield* asAgent(orchestrator)(activity.report({ kind: "turn-ended", running: [] }))
      expect((yield* seen).at(-1)).toMatchObject({ type: "session.seen", tests: { endedAt: 5000, outcome: "ended" } })
    })))

  it.effect("a subagent's stop ends its foreground run, and leaves its background run running while background_tasks lists it", () =>
    run(Effect.gen(function* () {
      const { activity } = yield* board
      const agents = yield* AgentService
      yield* asAgent(builder)(activity.report({ kind: "tests-started", toolUseId: "toolu_b", command: "bun run test:e2e", cwd: "/repo/wt" }))
      yield* asAgent(builder)(activity.report({ kind: "background", id: "blo3xolgq", label: "Bash · bun run test:e2e", toolUseId: "toolu_b" }))
      const waiting = yield* asAgent(orchestrator)(agents.report({ agentId: builder.agent, agentType: "cello-builder", state: "stopped", running: ["blo3xolgq"] }))
      expect(waiting).toMatchObject({ endedAt: null, waitingOn: ["Bash · bun run test:e2e"], tests: { endedAt: null, background: true } })

      yield* asAgent(reviewer)(activity.report({ kind: "tests-started", toolUseId: "toolu_r", command: "bun run test", cwd: "/repo/wt2" }))
      yield* TestClock.adjust("3 seconds")
      const stopped = yield* asAgent(orchestrator)(agents.report({ agentId: reviewer.agent, agentType: "cello-code-reviewer", state: "stopped", running: ["blo3xolgq"] }))
      expect(stopped).toMatchObject({ endedAt: 3000, tests: { endedAt: 3000, outcome: "ended" } })
    })))
})
