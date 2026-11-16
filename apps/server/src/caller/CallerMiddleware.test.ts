import * as fs from "node:fs"
import * as path from "node:path"
import { CallerMiddleware, Caller, IDENTITY_HEADERS } from "@cello/contract/rpcs"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Headers from "effect/http/Headers"
import * as Layer from "effect/Layer"
import * as Seed from "../persistence/Seed.ts"
import { AgentService } from "../session/AgentService.ts"
import * as ModelService from "../session/ModelService.ts"
import { SessionService } from "../session/SessionService.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import { services, TEST_HUMAN } from "../testing/TestLayers.ts"
import * as CallerLayer from "./CallerMiddleware.ts"

/** Runs the real middleware around a handler that reports the caller it sees. */
const callerFor = (headers: Record<string, string>) =>
  Effect.gen(function* () {
    const middleware = yield* CallerMiddleware
    const seen = yield* middleware(Effect.service(Caller) as any, {
      client: {} as any,
      requestId: 0n as any,
      rpc: {} as any,
      payload: {},
      headers: Headers.fromInput(headers),
    })
    return seen as unknown as Caller["Service"]
  }).pipe(Effect.scoped)

/** Claude Code's projects folder for the test: transcripts are read from here only (CEL-119). */
let projects = ""

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  Effect.gen(function* () {
    projects = path.join(yield* tempDataDir, "claude", "projects")
    return yield* effect.pipe(
      Effect.provide(CallerLayer.layer.pipe(Layer.provideMerge(ModelService.layer({ projectsDir: projects })), Layer.provideMerge(services()))),
    )
  }).pipe(Effect.scoped) as Effect.Effect<A, E>

const cli = {
  [IDENTITY_HEADERS.session]: "2fd0505c-417a",
  [IDENTITY_HEADERS.client]: "Claude Code",
  [IDENTITY_HEADERS.pid]: "4242",
  [IDENTITY_HEADERS.cwd]: "/Users/lnmunhoz/projects/cello",
  [IDENTITY_HEADERS.entrypoint]: "cli",
}

describe("CallerMiddleware", () => {
  it.effect("a browser connection resolves to the human actor", () =>
    run(Effect.gen(function* () {
      const human = yield* Seed.HumanActor
      const caller = yield* callerFor({
        origin: "http://localhost:5199",
        "user-agent": "Mozilla/5.0 (Macintosh) Safari/605.1.15",
      })
      expect(caller).toEqual({ actorId: human.id, sessionId: null })
      expect(human.name).toBe(TEST_HUMAN)
    })))

  it.effect("a headerless request resolves to the human actor", () =>
    run(Effect.gen(function* () {
      const human = yield* Seed.HumanActor
      expect(yield* callerFor({})).toEqual({ actorId: human.id, sessionId: null })
    })))

  it.effect("the CLI's identity headers resolve to one agent session, reused across calls", () =>
    run(Effect.gen(function* () {
      const human = yield* Seed.HumanActor
      const first = yield* callerFor(cli)
      const second = yield* callerFor(cli)
      expect(first.actorId).not.toBe(human.id)
      expect(first.sessionId).not.toBeNull()
      expect(second).toEqual(first)
    })))

  it.effect("the session \"me\" records the human even with agent headers", () =>
    run(Effect.gen(function* () {
      const human = yield* Seed.HumanActor
      expect(yield* callerFor({ ...cli, [IDENTITY_HEADERS.session]: "me" })).toEqual({ actorId: human.id, sessionId: null })
    })))

  // The check-in runs after the request: a write that already committed must still answer as a success,
  // or the CLI reports an error and a rerun does the change twice.
  it.effect("a check-in that fails after the request is logged, and the request's own result stands", () =>
    Effect.gen(function* () {
      const fake = SessionService.of({
        resolve: () => Effect.succeed({ actorId: "agent", sessionId: "s1" }),
        checkIn: () => Effect.die(new Error("database is locked")),
      } as unknown as SessionService["Service"])
      const agents = AgentService.of({ checkIn: () => Effect.void } as unknown as AgentService["Service"])
      const middleware = yield* CallerMiddleware.pipe(
        Effect.provide(CallerLayer.layer),
        Effect.provideService(SessionService, fake),
        Effect.provideService(AgentService, agents),
        Effect.provideService(ModelService.ModelService, ModelService.ModelService.of({ stamp: Effect.succeed })),
      )
      const result = yield* middleware(Effect.succeed("committed") as any, {
        client: {} as any,
        requestId: 0n as any,
        rpc: {} as any,
        payload: {},
        headers: Headers.fromInput(cli),
      })
      expect(result).toBe("committed")
    }).pipe(Effect.scoped))

  it("decodes the identity headers, ignoring a pid that isn't a number", () => {
    expect(CallerLayer.identityFromHeaders(Headers.fromInput(cli))).toEqual({
      session: "2fd0505c-417a",
      client: "Claude Code",
      pid: 4242,
      cwd: "/Users/lnmunhoz/projects/cello",
      entrypoint: "cli",
    })
    expect(CallerLayer.identityFromHeaders(Headers.fromInput({ [IDENTITY_HEADERS.pid]: "abc" }))).toEqual({})
    // The hooks send the session's permission mode (CEL-92).
    expect(CallerLayer.identityFromHeaders(Headers.fromInput({ [IDENTITY_HEADERS.permissionMode]: "auto" }))).toEqual({ permissionMode: "auto" })
    // And the transcript and current step (CEL-106).
    expect(CallerLayer.identityFromHeaders(Headers.fromInput({
      [IDENTITY_HEADERS.transcript]: "/home/u/.claude/projects/-repo/s.jsonl",
      [IDENTITY_HEADERS.step]: "Bash · bun run test",
    }))).toEqual({ transcript: "/home/u/.claude/projects/-repo/s.jsonl", step: "Bash · bun run test" })
  })

  it.effect("a subagent's headers (CEL-55) resolve to its session, with the agent named on the caller", () =>
    run(Effect.gen(function* () {
      const session = yield* callerFor(cli)
      const agent = yield* callerFor({ ...cli, [IDENTITY_HEADERS.agent]: "a13bfb89", [IDENTITY_HEADERS.agentType]: "cello-builder" })
      expect(agent).toEqual({ ...session, agentId: "a13bfb89" })
      expect(CallerLayer.identityFromHeaders(Headers.fromInput({ [IDENTITY_HEADERS.agent]: " a13bfb89 ", [IDENTITY_HEADERS.agentType]: "" })))
        .toEqual({ agent: "a13bfb89" })
    })))

  it.effect("the caller carries the model and effort its own transcript names (CEL-119), the session's and a subagent's", () =>
    run(Effect.gen(function* () {
      const reply = (model: string, effort: string) => `${JSON.stringify({ type: "assistant", effort, message: { model, content: [] } })}\n`
      const sessionFile = path.join(projects, "-repo", "2fd0505c-417a.jsonl")
      const agentFile = path.join(projects, "-repo", "2fd0505c-417a", "subagents", "agent-a13bfb89.jsonl")
      fs.mkdirSync(path.dirname(agentFile), { recursive: true })
      fs.writeFileSync(sessionFile, reply("claude-opus-5-5", "high"))
      fs.writeFileSync(agentFile, reply("claude-haiku-5-5", "medium"))
      const sub = { ...cli, [IDENTITY_HEADERS.agent]: "a13bfb89", [IDENTITY_HEADERS.agentType]: "Explore" }
      const session = yield* callerFor({ ...cli, [IDENTITY_HEADERS.transcript]: sessionFile })
      const agent = yield* callerFor({ ...sub, [IDENTITY_HEADERS.transcript]: agentFile })
      expect([session.model, session.effort]).toEqual(["claude-opus-5-5", "high"])
      expect([agent.model, agent.effort]).toEqual(["claude-haiku-5-5", "medium"])
      // A later call without the hook's header still reads the transcript the hook reported.
      expect((yield* callerFor(sub)).model).toBe("claude-haiku-5-5")
    })))
})
