// Who is calling, from per-request RPC headers. In M1 every caller is the seeded human: browser
// requests and headerless ones alike. Agent sessions (the x-cello-session header) arrive in M2.
import { Caller, CallerMiddleware } from "@cello/contract/rpcs"
import * as Effect from "effect/Effect"
import type * as Headers from "effect/http/Headers"
import * as Layer from "effect/Layer"
import * as Seed from "../persistence/Seed.ts"

/** The caller for one request's headers. */
export const resolveCaller = (_headers: Headers.Headers, human: Seed.HumanActor["Service"]): Caller["Service"] => ({
  actorId: human.id,
  sessionId: null,
})

export const layer = Layer.effect(CallerMiddleware, Effect.gen(function* () {
  const human = yield* Seed.HumanActor
  return CallerMiddleware.of((effect, { headers }) =>
    Effect.provideService(effect, Caller, resolveCaller(headers, human)))
}))

