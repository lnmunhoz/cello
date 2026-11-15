// Watches the sessions holding claims (CEL-35): every SWEEP_EVERY it marks the ones whose process
// exited as ended, so a card goes from "seen 4m ago" to "ended" without anyone calling. Check-ins
// themselves need no timer: they ride on the session's own requests (CallerMiddleware). A sweep that
// fails (a busy database during a backup) is logged, and the next one runs as usual.
import * as Cause from "effect/Cause"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schedule from "effect/Schedule"
import { SessionService } from "./SessionService.ts"

export const SWEEP_EVERY = Duration.seconds(30)

/** Runs forever: a sweep now, then one every SWEEP_EVERY. */
export const run = Effect.gen(function* () {
  const sessions = yield* SessionService
  const sweep = sessions.sweep.pipe(
    Effect.catchCause((cause) =>
      // Shutting down mid-sweep is an interruption, not a failure: let it through.
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.logError(`The presence sweep failed; the next one runs in ${Duration.format(SWEEP_EVERY)}.\n${Cause.pretty(cause)}`).pipe(Effect.as(0))
    ),
  )
  return yield* Effect.repeat(sweep, Schedule.spaced(SWEEP_EVERY))
})

/** The watch as a background fiber for the server's lifetime. */
export const layer = Layer.effectDiscard(Effect.forkScoped(run))
