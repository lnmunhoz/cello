// The session host (CEL-92), against the fake agent driver: a run's log (`runs/<session>/<time>.jsonl`)
// holds its start, the CLI's lines and its end; each session keeps its newest 20 logs; a server that
// shuts down stops its runs and records them stopped, and one that died without that records them
// stopped at its next start.
import * as fs from "node:fs"
import * as path from "node:path"
import type { CelloEvent } from "@cello/contract/events"
import { describe, expect, it } from "@effect/vitest"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Layer from "effect/Layer"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as SqlClient from "effect/sql/SqlClient"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import * as EventLog from "../events/EventLog.ts"
import * as TaskService from "../task/TaskService.ts"
import { type FakeAgent, makeFakeAgent } from "../testing/fakeAgent.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import * as AgentDriver from "./agents/AgentDriver.ts"
import { KEEP_LOGS } from "./WakeConfig.ts"
import * as SessionHost from "./SessionHost.ts"
import * as WakeConfig from "./WakeConfig.ts"

const agent = { session: "c14ca1fa-6f0e", client: "Claude Code", pid: 4242, cwd: "/repo", permissionMode: "auto" }

/** The host over the fake driver and a temp runs folder, inside an outer layer of services the test keeps. */
const hostLayer = (fake: FakeAgent, runsDir: string) =>
  SessionHost.layer.pipe(
    Layer.provideMerge(AgentDriver.layer([fake.driver])),
    Layer.provideMerge(WakeConfig.layer({ runsDir, env: Effect.succeed({}), isAlive: () => false })),
  )

/** CEL-1 claimed by the agent session; what `host.start` needs to run it. */
const claimed = Effect.gen(function* () {
  const tasks = yield* TaskService.TaskService
  const { project, workspace } = yield* setupProject
  const { result: task } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Run me" })
  const { result } = yield* asAgent(agent)(tasks.claim({ commandId: cmd(), key: task.key }))
  return {
    task,
    session: { id: result.assigneeSessionId!, actorId: result.assigneeActorId!, externalId: agent.session, cwd: agent.cwd },
    place: { workspaceId: workspace.id, projectId: project.id },
  }
})

const nextEnded = Effect.gen(function* () {
  const stream = yield* (yield* EventLog.EventLog).live
  return Stream.runHead(Stream.filter(stream, (e: CelloEvent) => e.type === "session.run_ended"))
})

describe("SessionHost", () => {
  it.effect("logs a run's start, the CLI's lines and its end; each session keeps its newest 20 logs", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeAgent()
      const runsDir = path.join(yield* tempDataDir, "runs")
      yield* Effect.gen(function* () {
        const host = yield* SessionHost.SessionHost
        const { task, session, place } = yield* claimed
        const start = () =>
          host.start({
            commandId: cmd(),
            session,
            driver: fake.driver,
            mode: { native: "auto", cello: "auto" },
            taskId: task.id,
            why: "comment",
            prompt: "Lucas acted on CEL-1",
            place,
          })
        for (let i = 0; i <= KEEP_LOGS; i++) {
          yield* start()
          const turn = yield* Queue.take(fake.turns)
          const ended = yield* nextEnded
          yield* turn.finish({ outcome: "failed", exitCode: 1, error: "claude exited with code 1" })
          yield* ended
          yield* TestClock.adjust("1 second")
        }
        const dir = path.join(runsDir, agent.session)
        const logs = fs.readdirSync(dir).sort()
        expect(logs).toHaveLength(KEEP_LOGS)
        expect(logs[0]).toBe(SessionHost.logName(1000))
        const runs = yield* host.runs(session.id)
        expect(runs).toHaveLength(KEEP_LOGS + 1)
        expect(runs[0]!.log).toBe(path.join(dir, SessionHost.logName(KEEP_LOGS * 1000)))
        const lines = fs.readFileSync(runs[0]!.log, "utf8").trim().split("\n").map((l) => JSON.parse(l))
        expect(lines.map((l) => l.type)).toEqual(["cello.run", "system", "cello.ended"])
        expect(lines[0]).toMatchObject({ run: { id: runs[0]!.run.id, outcome: "running" }, prompt: "Lucas acted on CEL-1" })
        expect(lines[2]).toEqual({ type: "cello.ended", outcome: "failed", exitCode: 1, error: "claude exited with code 1" })
        expect(runs[0]!.run).toMatchObject({ outcome: "failed", exitCode: 1, error: "claude exited with code 1" })
      }).pipe(Effect.provide(hostLayer(fake, runsDir)))
    }).pipe(asHuman, Effect.scoped, Effect.provide(services())))

  it.effect("a stopping server stops its runs and records them stopped; a run left running by a dead server is recorded stopped at the next start", () =>
    Effect.gen(function* () {
      const fake = yield* makeFakeAgent()
      const runsDir = path.join(yield* tempDataDir, "runs")
      const sql = yield* SqlClient.SqlClient
      const { task, session, place } = yield* claimed
      // A server: start a run, then stop the server while it goes.
      const scope = yield* Scope.make()
      const context = yield* Layer.buildWithScope(hostLayer(fake, runsDir), scope)
      const host = Context.get(context, SessionHost.SessionHost)
      const { result: run } = yield* host.start({
        commandId: cmd(),
        session,
        driver: fake.driver,
        mode: { native: "auto", cello: "auto" },
        taskId: task.id,
        why: "comment",
        prompt: "go",
        place,
      })
      yield* Queue.take(fake.turns)
      yield* Scope.close(scope, Exit.void)
      expect(yield* sql`SELECT outcome, ended_at IS NOT NULL AS ended FROM session_runs WHERE id = ${run.id}`).toEqual([{ outcome: "stopped", ended: 1 }])

      // A run the database still says is running, as a server that died would leave it.
      yield* sql`INSERT INTO session_runs (id, session_id, task_id, why, agent_kind, mode, cello_mode, started_at, outcome, log_path)
        VALUES ('left', ${session.id}, ${task.id}, 'comment', 'claude-code', 'auto', 'auto', 1, 'running', '/x')`
      yield* Effect.scoped(Layer.build(hostLayer(fake, runsDir)))
      expect(yield* sql`SELECT outcome, error FROM session_runs WHERE id = 'left'`).toEqual([
        { outcome: "stopped", error: "Cello stopped before the run ended" },
      ])
    }).pipe(asHuman, Effect.scoped, Effect.provide(services())))
})
