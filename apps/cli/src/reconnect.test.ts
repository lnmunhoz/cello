// Riding out a server restart (CEL-74, CEL-78): how long a waiting command keeps reconnecting to a
// server that went away, and the loop `cello inbox --wait`, `cello wait` and `cello task ask --wait`
// share. The loop runs on the TestClock: nothing here sleeps.
import { describe, expect, it } from "@effect/vitest"
import * as Clock from "effect/Clock"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Option from "effect/Option"
import * as TestClock from "effect/testing/TestClock"
import { afterDown, CONNECTED_MS, reconnectDelay, reconnecting, reconnectGrace, RECONNECT_GRACE_MS } from "./reconnect.ts"

describe("afterDown: what a waiter does when it finds the server down", () => {
  const quick = (at: number) => ({ started: at, ended: at + 5 })

  it("pauses, backing off, and gives up once the server has been away for the whole grace", () => {
    const first = afterDown(null, quick(1_000), 2_000)!
    expect(first).toEqual({ outage: { since: 1_005, attempt: 1 }, pause: 250 })
    const second = afterDown(first.outage, quick(1_260), 2_000)!
    expect(second).toEqual({ outage: { since: 1_005, attempt: 2 }, pause: 500 })
    expect(afterDown(second.outage, quick(3_000), 2_000)).toBeNull()
  })

  it("a call that ran for a while had a connection: dropping it starts a new outage", () => {
    const old = { since: 0, attempt: 5 }
    expect(afterDown(old, { started: 10_000, ended: 10_000 + CONNECTED_MS }, 2_000)).toEqual({
      outage: { since: 10_000 + CONNECTED_MS, attempt: 1 },
      pause: 250,
    })
  })

  it("CELLO_WAIT_RECONNECT_MS sets the grace (tests shorten it); anything else keeps two minutes", () => {
    expect(reconnectGrace({ CELLO_WAIT_RECONNECT_MS: "300" })).toBe(300)
    expect(reconnectGrace({})).toBe(RECONNECT_GRACE_MS)
    expect(reconnectGrace({ CELLO_WAIT_RECONNECT_MS: "soon" })).toBe(RECONNECT_GRACE_MS)
    expect(RECONNECT_GRACE_MS).toBe(120_000)
  })
})

describe("reconnectDelay", () => {
  it("backs off from a quarter second to at most 5 seconds between tries", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 10].map(reconnectDelay)).toEqual([250, 500, 1000, 2000, 4000, 5000, 5000, 5000])
  })
})

/** One call's outcome: the server answered, it was down, or the call was connected for `ms` and then dropped. */
type Turn = { readonly answer: string } | "down" | { readonly droppedAfter: number }

/**
 * `reconnecting` over a scripted call: each call takes the next turn. Records when each call started
 * (TestClock time) and each time the loop said the server went away.
 */
const scripted = (turns: ReadonlyArray<Turn>, grace = 2_000) => {
  const calls: Array<number> = []
  const said: Array<number> = []
  let next = 0
  const call = Effect.gen(function* () {
    calls.push(yield* Clock.currentTimeMillis)
    const turn = turns[Math.min(next++, turns.length - 1)]!
    if (turn === "down") return Option.none<string>()
    if ("droppedAfter" in turn) {
      yield* Effect.sleep(turn.droppedAfter)
      return Option.none<string>()
    }
    return Option.some(turn.answer)
  })
  const waiting = reconnecting(call, {
    grace,
    wentAway: Effect.flatMap(Clock.currentTimeMillis, (at) => Effect.sync(() => void said.push(at))),
    gaveUp: Effect.fail("gave up" as const),
  })
  return { calls, said, waiting }
}

describe("reconnecting: a waiting call that rides out a server restart", () => {
  it.effect("returns the answer at once when the server answers, saying nothing", () =>
    Effect.gen(function* () {
      const { calls, said, waiting } = scripted([{ answer: "answers" }])
      expect(yield* waiting).toBe("answers")
      expect(calls).toEqual([0])
      expect(said).toEqual([])
    }))

  it.effect("the server down: says so once, tries again after 250 ms, 500 ms, 1 s…, and returns the answer once it's back", () =>
    Effect.gen(function* () {
      const { calls, said, waiting } = scripted(["down", "down", "down", { answer: "answers" }])
      const fiber = yield* Effect.forkChild(waiting)
      yield* TestClock.adjust(60_000)
      expect(yield* Fiber.join(fiber)).toBe("answers")
      expect(calls).toEqual([0, 250, 750, 1_750])
      expect(said).toEqual([0])
    }))

  it.effect("gives up once the server has been away for the whole grace", () =>
    Effect.gen(function* () {
      const { calls, said, waiting } = scripted(["down"], 2_000)
      const fiber = yield* Effect.forkChild(waiting)
      yield* TestClock.adjust(60_000)
      expect(yield* Fiber.await(fiber)).toEqual(Exit.fail("gave up"))
      // The last try comes after the grace is up: one more look before giving up.
      expect(calls).toEqual([0, 250, 750, 1_750, 3_750])
      expect(said).toEqual([0])
    }))

  it.effect("a call that was connected and then dropped (a restart mid-wait) starts a new outage: says so again, and the grace starts over", () =>
    Effect.gen(function* () {
      const { calls, said, waiting } = scripted(["down", { droppedAfter: 10_000 }, "down", { answer: "answers" }], 2_000)
      const fiber = yield* Effect.forkChild(waiting)
      yield* TestClock.adjust(60_000)
      expect(yield* Fiber.join(fiber)).toBe("answers")
      // Down at 0; back at 250 and connected for 10 s; dropped at 10 250: a fresh quarter second, then a half.
      expect(calls).toEqual([0, 250, 10_500, 11_000])
      expect(said).toEqual([0, 10_250])
    }))
})
