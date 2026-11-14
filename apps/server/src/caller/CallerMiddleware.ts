// Who is calling, from per-request RPC headers. Browser and headerless requests are the human; the
// CLI's identity headers (x-cello-session and friends) resolve to an agent session.
import { Caller, CallerMiddleware, IDENTITY_HEADERS } from "@cello/contract/rpcs"
import * as Effect from "effect/Effect"
import type * as Headers from "effect/http/Headers"
import * as Layer from "effect/Layer"
import { type Identity, SessionService } from "../session/SessionService.ts"

/** The identity a request's headers describe. Absent or malformed headers are left out. */
export const identityFromHeaders = (headers: Headers.Headers): Identity => {
  const text = (name: string) => {
    const value = headers[name]?.trim()
    return value ? value : undefined
  }
  const pid = Number(text(IDENTITY_HEADERS.pid))
  const identity = {
    session: text(IDENTITY_HEADERS.session),
    client: text(IDENTITY_HEADERS.client),
    pid: Number.isInteger(pid) && pid > 0 ? pid : undefined,
    cwd: text(IDENTITY_HEADERS.cwd),
    entrypoint: text(IDENTITY_HEADERS.entrypoint),
  }
  return Object.fromEntries(Object.entries(identity).filter(([, v]) => v !== undefined)) as Identity
}

export const layer = Layer.effect(CallerMiddleware, Effect.gen(function* () {
  const sessions = yield* SessionService
  return CallerMiddleware.of((effect, { headers }) =>
    Effect.flatMap(sessions.resolve(identityFromHeaders(headers)), (caller) => Effect.provideService(effect, Caller, caller)))
}))
