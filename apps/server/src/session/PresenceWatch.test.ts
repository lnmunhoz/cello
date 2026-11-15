// The presence watch on the test clock: a sweep every 30 s, and one that fails (a busy database during
// a backup) is logged and the next one still runs.
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"
import * as PresenceWatch from "./PresenceWatch.ts"
import { SessionService } from "./SessionService.ts"

describe("PresenceWatch", () => {
  it.effect("sweeps now and every 30 s; a sweep that dies is logged and the watch carries on", () =>
    Effect.gen(function* () {
      let calls = 0
      const sweep = Effect.suspend(() => (++calls === 2 ? Effect.die(new Error("database is locked")) : Effect.succeed(0)))
      const fake = SessionService.of({ sweep } as unknown as SessionService["Service"])
      yield* Effect.forkScoped(PresenceWatch.run.pipe(Effect.provideService(SessionService, fake)))
      yield* TestClock.adjust("1 millis")
      expect(calls).toBe(1)
      yield* TestClock.adjust("30 seconds")
      expect(calls).toBe(2)
      yield* TestClock.adjust("30 seconds")
      expect(calls).toBe(3)
      yield* TestClock.adjust("30 seconds")
      expect(calls).toBe(4)
    }).pipe(Effect.scoped))
})
