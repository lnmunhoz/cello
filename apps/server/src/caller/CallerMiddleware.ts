// Who is calling, from per-request RPC headers. Browser and headerless requests are the human; the
// CLI's identity headers (x-cello-session and friends) resolve to an agent session, and `x-cello-agent`
// to one of its subagents (CEL-55). After the request, succeeded or not, the session (and the agent)
// has checked in: boards hear it if it holds a claim, or the agent is on a task (CEL-35).
import { Caller, CallerMiddleware, IDENTITY_HEADERS } from "@cello/contract/rpcs"
import * as Cause from "effect/Cause"
import * as Effect from "effect/Effect"
import type * as Headers from "effect/http/Headers"
import * as Layer from "effect/Layer"
import { AgentService } from "../session/AgentService.ts"
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
    agent: text(IDENTITY_HEADERS.agent),
    agentType: text(IDENTITY_HEADERS.agentType),
    permissionMode: text(IDENTITY_HEADERS.permissionMode),
  }
  return Object.fromEntries(Object.entries(identity).filter(([, v]) => v !== undefined)) as Identity
}

export const layer = Layer.effect(CallerMiddleware, Effect.gen(function* () {
  const sessions = yield* SessionService
  const agents = yield* AgentService
  // After the request, which may have committed a write: a failed check-in must not turn its answer into
  // an error (a rerun would do the change twice), so it's logged instead.
  const checkIn = (caller: Caller["Service"]) =>
    Effect.andThen(sessions.checkIn(caller), agents.checkIn(caller)).pipe(
      Effect.catchCause((cause) => Effect.logWarning(`A session check-in failed; boards hear it on its next call.\n${Cause.pretty(cause)}`)),
    )
  return CallerMiddleware.of((effect, { headers }) =>
    Effect.flatMap(sessions.resolve(identityFromHeaders(headers)), (caller) =>
      Effect.provideService(effect, Caller, caller).pipe(Effect.ensuring(checkIn(caller)))))
}))
