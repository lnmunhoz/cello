// Which model a caller is on (CEL-119): read from the end of its own Claude Code transcript as each request
// comes in (the session's, or with a subagent the subagent's), kept on the session or subagent as its
// current model, and written with its comments and events. Unknown stays unknown; reading never fails a call.
import * as fs from "node:fs"
import * as path from "node:path"
import { Caller } from "@cello/contract/rpcs"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import { CommentService } from "../comment/CommentService.ts"
import { EventStore } from "../events/EventStore.ts"
import { TaskService } from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import { AgentService } from "./AgentService.ts"
import { layer, ModelService } from "./ModelService.ts"
import { SessionService } from "./SessionService.ts"

const reply = (model: string, effort?: string) =>
  `${JSON.stringify({ type: "assistant", uuid: crypto.randomUUID(), ...(effort ? { effort } : {}), message: { model, role: "assistant", content: [{ type: "text", text: "ok" }] } })}\n`

const files = { projects: "", session: "", builder: "" }

/** Every service, the model read from a temp projects/ folder, with the orchestrator's and its builder's transcripts. */
const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.gen(function* () {
    const dir = yield* tempDataDir
    files.projects = path.join(dir, "claude", "projects")
    files.session = path.join(files.projects, "-work-pancakes", "s1.jsonl")
    files.builder = path.join(files.projects, "-work-pancakes", "s1", "subagents", "agent-a13b.jsonl")
    fs.mkdirSync(path.dirname(files.builder), { recursive: true })
    fs.writeFileSync(files.session, reply("claude-opus-5-5", "high"))
    fs.writeFileSync(files.builder, reply("claude-sonnet-5-5", "medium"))
    return yield* effect.pipe(Effect.provide(layer({ projectsDir: files.projects }).pipe(Layer.provideMerge(services()))))
  }).pipe(Effect.scoped) as Effect.Effect<A, E>

const orchestrator = { session: "2fd0505c-417a", client: "Claude Code", pid: 4242, cwd: "/work/pancakes" }
const builder = { ...orchestrator, agent: "a13b", agentType: "cello-builder" }

/** The hooks have told the server both transcripts (as SessionStart and SubagentStart do). */
const hooksReported = Effect.gen(function* () {
  yield* asAgent({ ...orchestrator, transcript: files.session })(Effect.void)
  yield* asAgent({ ...builder, transcript: files.builder })(Effect.void)
})

const callerOf = (identity: Parameters<typeof asAgent>[0]) => asAgent(identity)(Effect.service(Caller))

/** A task in a fresh project, to comment on. */
const aTask = asHuman(Effect.gen(function* () {
  const { project } = yield* setupProject
  return (yield* (yield* TaskService).create({ commandId: cmd(), projectId: project.id, title: "Pancake timer" })).result
}))

const comment = (identity: Parameters<typeof asAgent>[0], taskId: string, body: string) =>
  asAgent(identity)(Effect.flatMap(Effect.service(CommentService), (c) => c.add({ commandId: cmd(), taskId, body })).pipe(Effect.map((w) => w.result)))

describe("ModelService.stamp", () => {
  it.effect("gives the session its own transcript's model and effort, and keeps it as the session's current model", () =>
    run(Effect.gen(function* () {
      yield* hooksReported
      const caller = yield* callerOf(orchestrator)
      expect([caller.model, caller.effort]).toEqual(["claude-opus-5-5", "high"])
      const [session] = yield* (yield* SessionService).byIds([caller.sessionId!])
      expect([session!.model, session!.effort]).toEqual(["claude-opus-5-5", "high"])
    })))

  it.effect("gives a subagent its own transcript's model, not its session's, and keeps it on the subagent", () =>
    run(Effect.gen(function* () {
      yield* hooksReported
      const caller = yield* callerOf(builder)
      expect([caller.agentId, caller.model, caller.effort]).toEqual(["a13b", "claude-sonnet-5-5", "medium"])
      const [agent] = yield* (yield* AgentService).byRefs([{ sessionId: caller.sessionId!, agentId: "a13b" }])
      expect([agent!.model, agent!.effort]).toEqual(["claude-sonnet-5-5", "medium"])
      const [session] = yield* (yield* SessionService).byIds([caller.sessionId!])
      expect(session!.model).toBe("claude-opus-5-5")
    })))

  it.effect("writes each comment and its event with the model of that moment: a /model switch shows on new comments only", () =>
    run(Effect.gen(function* () {
      yield* hooksReported
      const task = yield* aTask
      const before = yield* comment(orchestrator, task.id, "On Opus")
      fs.appendFileSync(files.session, reply("claude-sonnet-5-5", "low"))
      const after = yield* comment(orchestrator, task.id, "On Sonnet now")
      const fromBuilder = yield* comment(builder, task.id, "From the builder")
      expect([before.model, before.effort]).toEqual(["claude-opus-5-5", "high"])
      expect([after.model, after.effort]).toEqual(["claude-sonnet-5-5", "low"])
      expect([fromBuilder.agentId, fromBuilder.model, fromBuilder.effort]).toEqual(["a13b", "claude-sonnet-5-5", "medium"])
      // Read back: the first comment keeps Opus.
      const thread = yield* asHuman(Effect.flatMap(Effect.service(CommentService), (c) => c.list(task.id)))
      expect(thread.map((c) => [c.body, c.model, c.effort])).toEqual([
        ["On Opus", "claude-opus-5-5", "high"],
        ["On Sonnet now", "claude-sonnet-5-5", "low"],
        ["From the builder", "claude-sonnet-5-5", "medium"],
      ])
      const history = yield* (yield* EventStore).history(after.id)
      expect(history.map((e) => [e.type, e.model, e.effort])).toEqual([["comment.added", "claude-sonnet-5-5", "low"]])
    })))

  it.effect("says nothing for the human, a session no hook reported a transcript for, or a transcript with no reply yet", () =>
    run(Effect.gen(function* () {
      const human = yield* asHuman(Effect.flatMap(Effect.service(Caller), (c) => Effect.flatMap(Effect.service(ModelService), (m) => m.stamp(c))))
      expect([human.model ?? null, human.effort ?? null]).toEqual([null, null])
      const quiet = yield* callerOf(orchestrator)
      expect([quiet.model, quiet.effort]).toEqual([null, null])
      fs.writeFileSync(files.session, `${JSON.stringify({ type: "user", message: { content: "Build it." } })}\n`)
      const early = yield* callerOf({ ...orchestrator, transcript: files.session })
      expect([early.model, early.effort]).toEqual([null, null])
      const task = yield* aTask
      const written = yield* comment(orchestrator, task.id, "No model yet")
      expect([written.model, written.effort]).toEqual([null, null])
    })))

  it.effect("keeps the last model it knew when the transcript is gone later, without making one up for the comment", () =>
    run(Effect.gen(function* () {
      yield* hooksReported
      const first = yield* callerOf(orchestrator)
      fs.rmSync(files.session)
      const later = yield* callerOf(orchestrator)
      expect(later.model).toBeNull()
      const [session] = yield* (yield* SessionService).byIds([first.sessionId!])
      expect(session!.model).toBe("claude-opus-5-5")
    })))

  it.effect("never fails the call: a storage failure while stamping leaves the caller as it was", () =>
    run(Effect.gen(function* () {
      yield* hooksReported
      const sql = yield* SqlClient.SqlClient
      // Lose the columns it reads: every query it makes now fails.
      yield* sql`ALTER TABLE agent_sessions RENAME COLUMN model TO lost_model`.pipe(Effect.orDie)
      const caller = yield* callerOf(orchestrator)
      expect(caller.sessionId).not.toBeNull()
      expect(caller.model ?? null).toBeNull()
    })))
})
