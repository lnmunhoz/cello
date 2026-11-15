// The daily backup. When the server starts it checks the newest auto backup: 24 hours old or more (or
// none), it takes one; otherwise it waits until that one turns 24 hours old. Then it repeats every 24
// hours. Manual backups don't count. A failed backup logs a clear error and is tried again an hour
// later; it never takes the server down.
import type { Backup } from "@cello/contract/backups"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schedule from "effect/Schedule"
import { BackupService } from "./BackupService.ts"

export const INTERVAL = Duration.hours(24)
export const RETRY_AFTER = Duration.hours(1)

/** What one check did. */
export type Check =
  | { readonly _tag: "Taken"; readonly backup: Backup }
  | { readonly _tag: "NotDue"; readonly newest: Backup }
  | { readonly _tag: "Failed"; readonly error: string }

interface Checked {
  readonly check: Check
  /** How long until the next check. */
  readonly next: Duration.Duration
}

/** Takes an auto backup if one is due. Never fails: a failed backup is logged and reported. */
const check: Effect.Effect<Checked, never, BackupService> = Effect.gen(function* () {
  const backups = yield* BackupService
  const now = yield* Clock.currentTimeMillis
  const newest = (yield* backups.list()).find((b) => b.kind === "auto")
  const age = newest === undefined ? Infinity : now - newest.createdAt
  if (newest !== undefined && age < Duration.toMillis(INTERVAL)) {
    return { check: { _tag: "NotDue", newest }, next: Duration.millis(Duration.toMillis(INTERVAL) - age) } satisfies Checked
  }
  const backup = yield* backups.create({ kind: "auto" })
  return { check: { _tag: "Taken", backup }, next: INTERVAL } satisfies Checked
}).pipe(
  Effect.catchCause((cause) => {
    // Shutting down mid-backup is an interruption, not a failure: let it through.
    if (Cause.hasInterruptsOnly(cause)) return Effect.failCause(cause)
    const error = Cause.pretty(cause)
    return Effect.logError(
      `The daily backup failed; Cello keeps running and tries again in an hour. Run \`cello backup\` to take one by hand.\n${error}`,
    ).pipe(Effect.as({ check: { _tag: "Failed", error }, next: RETRY_AFTER } satisfies Checked))
  }),
)

/** The next check comes when the last one said. */
const whenDue = Schedule.modifyDelay(Schedule.setInputType<Checked>()(Schedule.forever), ({ input }) => Effect.succeed(input.next))

/** Runs forever. `onCheck` sees every check, for tests. */
export const run = (options: { readonly onCheck?: (check: Check) => Effect.Effect<void> } = {}) => {
  const reported: Effect.Effect<Checked, never, BackupService> = Effect.tap(check, ({ check }) => options.onCheck?.(check) ?? Effect.void)
  return Effect.repeat(reported, whenDue)
}

/** The schedule as a background fiber for the server's lifetime. */
export const layer = Layer.effectDiscard(Effect.forkScoped(run()))
