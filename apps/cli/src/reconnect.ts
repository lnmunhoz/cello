// Riding out a server restart (CEL-74, CEL-78). The commands that wait for Lucas (`cello inbox --wait`,
// `cello wait`, `cello task ask --wait`) hold a call open on the server for as long as he takes, and
// every deploy restarts the server under them. Instead of failing, they reconnect: a call that finds
// the server down pauses (a quarter second, doubling, at most 5 seconds) and tries again, and only once
// the server has been away for the whole grace (2 minutes) do they give up. The calls they make are safe
// to repeat: they take or hand over nothing until they return, and `ask.wait` sends the same command id
// on every try, so a reply lost to the restart is handed back on the next (CEL-78).
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Option from "effect/Option"
import type { Env } from "./identity.ts"

/** How long a waiter keeps reconnecting to a server that went away before it gives up (a restart takes seconds). */
export const RECONNECT_GRACE_MS = 120_000

/** The pause before reconnect try `attempt` (0 first): a quarter second, doubling, at most 5 seconds. */
export const reconnectDelay = (attempt: number): number => Math.min(250 * 2 ** attempt, 5_000)

/**
 * A call that lasted this long had a connection (a server that's down refuses at once), so when it
 * drops, a new outage starts and the grace starts over.
 */
export const CONNECTED_MS = 5_000

/** The server has been unreachable since `since`; `attempt` reconnects were made. */
export interface Outage {
  readonly since: number
  readonly attempt: number
}

/**
 * After a call that found the server down (`started` and `ended` are when it ran): how long to pause
 * before the next try, and the outage so far; null once it has been down for the whole `grace`.
 */
export const afterDown = (
  outage: Outage | null,
  call: { readonly started: number; readonly ended: number },
  grace: number,
): { readonly outage: Outage; readonly pause: number } | null => {
  // A new outage always gets one more try; a running one ends once it has lasted the grace.
  const current = outage === null || call.ended - call.started >= CONNECTED_MS ? { since: call.ended, attempt: 0 } : outage
  if (current === outage && call.ended - outage.since >= grace) return null
  return { outage: { since: current.since, attempt: current.attempt + 1 }, pause: reconnectDelay(current.attempt) }
}

/** The grace: RECONNECT_GRACE_MS, or CELLO_WAIT_RECONNECT_MS (tests shorten it). */
export const reconnectGrace = (env: Env): number => {
  const value = env.CELLO_WAIT_RECONNECT_MS ? Number(env.CELLO_WAIT_RECONNECT_MS) : Number.NaN
  return Number.isFinite(value) && value >= 0 ? value : RECONNECT_GRACE_MS
}

/**
 * Runs `call` until it reaches the server and returns what it got. `call` gives none when no server
 * answered (it was down, or the connection dropped mid-call); then this pauses and calls again, running
 * `wentAway` once at the start of each outage. Once an outage has lasted `grace`, it ends with `gaveUp`.
 */
export const reconnecting = <A, E, R, E2, R2>(
  call: Effect.Effect<Option.Option<A>, E, R>,
  options: {
    readonly grace: number
    readonly wentAway: Effect.Effect<void, never, R2>
    readonly gaveUp: Effect.Effect<never, E2, R2>
  },
): Effect.Effect<A, E | E2, R | R2> =>
  Effect.gen(function* () {
    let outage: Outage | null = null
    while (true) {
      const started = yield* Clock.currentTimeMillis
      const reached = yield* call
      if (Option.isSome(reached)) return reached.value
      const next = afterDown(outage, { started, ended: yield* Clock.currentTimeMillis }, options.grace)
      if (next === null) return yield* options.gaveUp
      if (next.outage.attempt === 1) yield* options.wentAway
      outage = next.outage
      yield* Effect.sleep(next.pause)
    }
  })
