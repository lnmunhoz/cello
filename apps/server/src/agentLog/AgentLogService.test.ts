// Whose log `agent.log` reads (CEL-106): the transcript a hook reported for the session or subagent, or
// a woken run's log; nothing for an agent no hook told it about; never a path outside Claude Code's
// projects/ folder; keys shown only to the human who asks. The watcher is a hand-driven one here.
import * as fs from "node:fs"
import * as path from "node:path"
import type { LogUpdate } from "@cello/contract/agentLog"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as SqlClient from "effect/sql/SqlClient"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import * as WakeConfig from "../wake/WakeConfig.ts"
import { AgentLogService, layer } from "./AgentLogService.ts"

const KEY = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
const said = (uuid: string, text: string) =>
  `${JSON.stringify({ type: "assistant", uuid, timestamp: "2026-11-16T09:00:00.000Z", message: { id: uuid, content: [{ type: "text", text }] } })}\n`

interface World {
  projects: string
  runs: string
  outside: string
}
const world: World = { projects: "", runs: "", outside: "" }

/** Every service, the log over a temp projects/ and runs/ folder, and the folders made. */
const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.gen(function* () {
    const dir = yield* tempDataDir
    world.projects = path.join(dir, "claude", "projects")
    world.runs = path.join(dir, "runs")
    world.outside = path.join(dir, "elsewhere")
    for (const d of [path.join(world.projects, "-work-pancakes", "s1", "subagents"), path.join(world.runs, "s1"), world.outside]) {
      fs.mkdirSync(d, { recursive: true })
    }
    return yield* effect.pipe(
      Effect.provide(
        layer({ projectsDir: world.projects, watch: () => () => {} }).pipe(
          Layer.provideMerge(WakeConfig.layer({ runsDir: world.runs, env: Effect.succeed({}) })),
          Layer.provideMerge(services()),
        ),
      ),
    )
  }).pipe(Effect.scoped) as Effect.Effect<A, E>

const orchestrator = { session: "2fd0505c-417a", client: "Claude Code", pid: 4242, cwd: "/work/pancakes" }

/** The first update of a log, as `caller` sees it. */
const firstOf = (source: Parameters<AgentLogService["Service"]["log"]>[0]) =>
  Effect.gen(function* () {
    const logs = yield* AgentLogService
    return yield* logs.log(source).pipe(Stream.runHead, Effect.map((head) => (head._tag === "Some" ? head.value : null)))
  })

const sessionIdOf = (external: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const [row] = yield* sql<{ id: string }>`SELECT id FROM agent_sessions WHERE external_id = ${external}`
    return row!.id
  }).pipe(Effect.orDie)

const text = (update: LogUpdate | null) => (update?._tag === "steps" ? update.steps.map((s) => s.text) : update)

describe("AgentLogService.log", () => {
  it.effect("reads the session's transcript and a subagent's, each where its hook said", () =>
    run(Effect.gen(function* () {
      const sessionFile = path.join(world.projects, "-work-pancakes", "s1.jsonl")
      const agentFile = path.join(world.projects, "-work-pancakes", "s1", "subagents", "agent-a13b.jsonl")
      fs.writeFileSync(sessionFile, said("m1", "Launching the builder."))
      fs.writeFileSync(agentFile, said("m2", "Building."))
      yield* asAgent({ ...orchestrator, transcript: sessionFile })(Effect.void)
      yield* asAgent({ ...orchestrator, agent: "a13b", agentType: "cello-builder", transcript: agentFile })(Effect.void)
      const sessionId = yield* sessionIdOf(orchestrator.session)
      expect(text(yield* asHuman(firstOf({ sessionId })))).toEqual(["Launching the builder."])
      expect(text(yield* asHuman(firstOf({ sessionId, agentId: "a13b" })))).toEqual(["Building."])
    })))

  it.effect("says none for an agent no hook reported a transcript for, and NotFound for one it doesn't know", () =>
    run(Effect.gen(function* () {
      yield* asAgent(orchestrator)(Effect.void)
      const sessionId = yield* sessionIdOf(orchestrator.session)
      expect(yield* asHuman(firstOf({ sessionId }))).toEqual({ _tag: "unavailable", reason: "none" })
      const unknown = yield* asHuman(firstOf({ sessionId, agentId: "nope" })).pipe(Effect.flip)
      expect(unknown).toMatchObject({ _tag: "NotFound", entity: "agent", id: "nope" })
      expect(yield* asHuman(firstOf({ sessionId: "no-such-session" })).pipe(Effect.flip)).toMatchObject({ _tag: "NotFound", entity: "session" })
    })))

  it.effect("refuses a reported transcript outside Claude Code's projects folder, even one a symlink inside points to", () =>
    run(Effect.gen(function* () {
      const secret = path.join(world.outside, "secret.jsonl")
      fs.writeFileSync(secret, said("m1", "not for you"))
      yield* asAgent({ ...orchestrator, transcript: secret })(Effect.void)
      const sessionId = yield* sessionIdOf(orchestrator.session)
      expect(yield* asHuman(firstOf({ sessionId }))).toEqual({ _tag: "unavailable", reason: "refused" })
      const link = path.join(world.projects, "-work-pancakes", "link.jsonl")
      fs.symlinkSync(secret, link)
      yield* asAgent({ ...orchestrator, transcript: link })(Effect.void)
      expect(yield* asHuman(firstOf({ sessionId }))).toEqual({ _tag: "unavailable", reason: "refused" })
    })))

  it.effect("masks keys for everyone; only the human's reveal shows them, an agent's is ignored", () =>
    run(Effect.gen(function* () {
      const file = path.join(world.projects, "-work-pancakes", "s1.jsonl")
      fs.writeFileSync(file, said("m1", `token ${KEY}`))
      yield* asAgent({ ...orchestrator, transcript: file })(Effect.void)
      const sessionId = yield* sessionIdOf(orchestrator.session)
      expect(JSON.stringify(yield* asHuman(firstOf({ sessionId })))).not.toContain(KEY)
      expect(JSON.stringify(yield* asHuman(firstOf({ sessionId, reveal: true })))).toContain(KEY)
      expect(JSON.stringify(yield* asAgent(orchestrator)(firstOf({ sessionId, reveal: true })))).not.toContain(KEY)
    })))

  it.effect("reads a woken run's log (CEL-92) of that session only", () =>
    run(Effect.gen(function* () {
      yield* asAgent(orchestrator)(Effect.void)
      const sessionId = yield* sessionIdOf(orchestrator.session)
      const log = path.join(world.runs, "s1", "1.jsonl")
      fs.writeFileSync(log, `${JSON.stringify({ type: "cello.run", run: { why: "comment" }, prompt: "Read the comment." })}\n`)
      const sql = yield* SqlClient.SqlClient
      yield* sql`INSERT INTO session_runs (id, session_id, why, agent_kind, mode, cello_mode, started_at, outcome, log_path)
        VALUES ('r1', ${sessionId}, 'comment', 'claude-code', 'auto', 'auto', 1, 'running', ${log})`.pipe(Effect.orDie)
      expect(text(yield* asHuman(firstOf({ sessionId, runId: "r1" })))).toEqual(["Cello woke this session (comment): Read the comment."])
      expect(yield* asHuman(firstOf({ sessionId: "other", runId: "r1" })).pipe(Effect.flip)).toMatchObject({ _tag: "NotFound", entity: "run" })
    })))
})
