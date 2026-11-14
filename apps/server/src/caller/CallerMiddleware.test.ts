import { CallerMiddleware, Caller } from "@cello/contract/rpcs"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Headers from "effect/http/Headers"
import * as Layer from "effect/Layer"
import * as Seed from "../persistence/Seed.ts"
import * as CallerLayer from "./CallerMiddleware.ts"

const human = { id: "human-1", name: "Lucas" }

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
  }).pipe(Effect.scoped, Effect.provide(CallerLayer.layer.pipe(Layer.provide(Layer.succeed(Seed.HumanActor)(human)))))

describe("CallerMiddleware", () => {
  it.effect("a browser connection resolves to the human actor", () =>
    Effect.gen(function* () {
      const caller = yield* callerFor({
        origin: "http://localhost:5199",
        "user-agent": "Mozilla/5.0 (Macintosh) Safari/605.1.15",
      })
      expect(caller).toEqual({ actorId: human.id, sessionId: null })
    }))

  it.effect("a headerless request resolves to the human actor", () =>
    Effect.gen(function* () {
      expect(yield* callerFor({})).toEqual({ actorId: human.id, sessionId: null })
    }))
})
