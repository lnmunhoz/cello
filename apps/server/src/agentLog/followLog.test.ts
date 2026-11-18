// Following a log (CEL-106): the first batch, new steps as lines are appended, a tool call updated when
// its result lands, keys masked, and the file going missing, coming back or being refused. The watcher
// is a hand-driven one here, so each change is a call, not a wait; the real watcher is covered by the
// integration test.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { LogUpdate } from "@cello/contract/agentLog"
import { MAX_FIRST_STEPS } from "@cello/contract/agentLog"
import { describe, expect, it } from "@effect/vitest"
import * as Cause from "effect/Cause"
import * as Clock from "effect/Clock"
import * as Duration from "effect/Duration"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Fiber from "effect/Fiber"
import * as Queue from "effect/Queue"
import * as Scope from "effect/Scope"
import * as Stream from "effect/Stream"
import * as TestClock from "effect/testing/TestClock"
import { type FileTail, fileTail } from "./FileTail.ts"
import { FOLLOW_RECHECK, followLog, type Watch } from "./followLog.ts"
import type { Guarded } from "./transcriptPath.ts"

const line = (value: object) => `${JSON.stringify(value)}\n`
const said = (uuid: string, text: string) =>
  line({ type: "assistant", uuid, timestamp: "2026-11-16T09:00:00.000Z", message: { id: uuid, content: [{ type: "text", text }] } })
const call = (uuid: string, id: string, command: string) =>
  line({ type: "assistant", uuid, timestamp: "2026-11-16T09:00:01.000Z", message: { id: uuid, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } })
const result = (uuid: string, id: string, content: string) =>
  line({ type: "user", uuid, timestamp: "2026-11-16T09:00:03.000Z", message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: false }] } })

/** A watcher the test fires by hand, and whether it's been closed. */
const handWatch = () => {
  const state = { fire: () => {}, closed: false }
  const watch: Watch = (_file, onChange) => {
    state.fire = onChange
    return () => void (state.closed = true)
  }
  return { watch, state }
}

/** Follows `file`, handing each update to a queue the test reads from. */
const follow = (file: string, options: { readonly check?: () => Guarded; readonly reveal?: boolean } = {}) =>
  Effect.gen(function* () {
    const { watch, state } = handWatch()
    const updates = yield* Queue.unbounded<LogUpdate>()
    yield* followLog({ file, check: options.check ?? (() => ({ _tag: "ok", file })), reveal: options.reveal ?? false, watch }).pipe(
      Stream.runForEach((u) => Queue.offer(updates, u)),
      Effect.forkScoped,
    )
    return { next: Queue.take(updates), state }
  })

/**
 * Follows `file` with seams for the re-check (CEL-126): a watcher that drops every change until the test
 * arms it, the number of lines each read returned, and how many sleeps the follow has started.
 */
const seamed = (file: string) =>
  Effect.gen(function* () {
    const state = { armed: false, fire: () => {}, closed: false, sleeps: 0 }
    const watch: Watch = (_file, onChange) => {
      state.fire = () => void (state.armed && onChange())
      return () => void (state.closed = true)
    }
    const reads = yield* Queue.unbounded<number>()
    const open = (f: string): FileTail => {
      const tail = fileTail(f)
      return {
        read: () => {
          const read = tail.read()
          Queue.offerUnsafe(reads, read._tag === "lines" ? read.lines.length : -1)
          return read
        },
      }
    }
    const clock = yield* Clock.Clock
    const counting = new Proxy(clock, {
      get: (target, key) => key === "sleep" ? (d: Duration.Duration) => (state.sleeps++, target.sleep(d)) : Reflect.get(target, key),
    })
    const updates = yield* Queue.unbounded<LogUpdate>()
    const fiber = yield* followLog({ file, check: () => ({ _tag: "ok", file }), reveal: false, watch, open }).pipe(
      Stream.runForEach((u) => Queue.offer(updates, u)),
      Effect.provideService(Clock.Clock, counting),
      Effect.forkScoped,
    )
    return { updates, reads, state, fiber }
  })

const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cel106-follow-")), "t.jsonl")

describe("followLog", () => {
  it.effect("sends what's there first, then each new step as it's appended, and a call again when its result lands", () =>
    Effect.gen(function* () {
      const file = tempFile()
      fs.writeFileSync(file, said("m1", "Starting."))
      const { next, state } = yield* follow(file)
      expect(yield* next).toEqual({
        _tag: "steps",
        reset: true,
        skipped: 0,
        steps: [{ id: "m1:0", kind: "message", at: Date.parse("2026-11-16T09:00:00.000Z"), text: "Starting." }],
      })
      fs.appendFileSync(file, call("m2", "toolu_1", "bun run test"))
      state.fire()
      expect(yield* next).toMatchObject({ _tag: "steps", reset: false, steps: [{ id: "toolu_1", text: "Bash · bun run test", tool: { status: "running" } }] })
      fs.appendFileSync(file, result("u1", "toolu_1", "ok, export GH=ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"))
      state.fire()
      const done = yield* next
      expect(done).toMatchObject({ _tag: "steps", steps: [{ id: "toolu_1", tool: { status: "ok", durationMs: 2000 }, masked: true }] })
      expect(JSON.stringify(done)).not.toContain("I9j0K1l2")
    }).pipe(Effect.scoped))

  it.effect("tells how many thoughts Claude Code saved without their words: with the first batch, and again when more arrive with no step to send (CEL-170)", () =>
    Effect.gen(function* () {
      const file = tempFile()
      const emptyThought = (uuid: string) =>
        line({ type: "assistant", uuid, timestamp: "2026-11-16T09:00:00.000Z", message: { id: uuid, content: [{ type: "thinking", thinking: "", signature: "c2ln" }] } })
      fs.writeFileSync(file, emptyThought("t1"))
      const { next, state } = yield* follow(file)
      expect(yield* next).toEqual({ _tag: "steps", reset: true, skipped: 0, steps: [], unsavedThinking: 1 })
      fs.appendFileSync(file, emptyThought("t2"))
      state.fire()
      expect(yield* next).toEqual({ _tag: "steps", reset: false, skipped: 0, steps: [], unsavedThinking: 2 })
      // A step arriving later carries the count too, so a log that reset keeps it.
      fs.appendFileSync(file, said("m1", "Done thinking."))
      state.fire()
      expect(yield* next).toMatchObject({ _tag: "steps", reset: false, steps: [{ text: "Done thinking." }], unsavedThinking: 2 })
    }).pipe(Effect.scoped))

  it.effect("sends a command with its call, masked, and marks the message that ended the turn (CEL-170)", () =>
    Effect.gen(function* () {
      const file = tempFile()
      fs.writeFileSync(
        file,
        line({
          type: "assistant",
          uuid: "m1",
          timestamp: "2026-11-16T09:00:01.000Z",
          message: {
            id: "m1",
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "git push https://ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8@x.com", description: "Push the branch" } }],
          },
        }) + line({ type: "assistant", uuid: "m2", timestamp: "2026-11-16T09:00:05.000Z", message: { id: "m2", stop_reason: "end_turn", content: [{ type: "text", text: "Pushed." }] } }),
      )
      const { next } = yield* follow(file)
      const first = yield* next
      expect(first).toMatchObject({ steps: [{ text: "Bash · Push the branch", masked: true }, { text: "Pushed.", endsTurn: true }] })
      expect(JSON.stringify(first)).not.toContain("I9j0K1l2")
      expect(first).not.toHaveProperty("unsavedThinking")
    }).pipe(Effect.scoped))

  it.effect("the human can see what was masked", () =>
    Effect.gen(function* () {
      const file = tempFile()
      fs.writeFileSync(file, said("m1", "key ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"))
      const { next } = yield* follow(file, { reveal: true })
      expect(JSON.stringify(yield* next)).toContain("ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8")
    }).pipe(Effect.scoped))

  it.effect("says missing when the file isn't there, then sends it from the start once it is, and missing again when it goes", () =>
    Effect.gen(function* () {
      const file = tempFile()
      const { next, state } = yield* follow(file)
      expect(yield* next).toEqual({ _tag: "unavailable", reason: "missing" })
      fs.writeFileSync(file, said("m1", "Here now."))
      state.fire()
      expect(yield* next).toMatchObject({ _tag: "steps", reset: true, steps: [{ text: "Here now." }] })
      fs.rmSync(file)
      state.fire()
      expect(yield* next).toEqual({ _tag: "unavailable", reason: "missing" })
    }).pipe(Effect.scoped))

  it.effect("ends with refused when the guard turns the path away, and closes the watcher", () =>
    Effect.gen(function* () {
      const file = tempFile()
      fs.writeFileSync(file, said("m1", "x"))
      const { watch, state } = handWatch()
      const all = yield* followLog({ file, check: () => ({ _tag: "refused" }), reveal: false, watch }).pipe(Stream.runCollect)
      expect(all).toEqual([{ _tag: "unavailable", reason: "refused" }])
      expect(state.closed).toBe(true)
    }))

  it.effect("ends with unreadable when the file can't be read, or a read throws, and closes the watcher", () =>
    Effect.gen(function* () {
      const file = tempFile()
      fs.writeFileSync(file, said("m1", "x"))
      for (const open of [
        () => ({ read: () => ({ _tag: "unreadable" as const }) }),
        () => ({
          read: () => {
            throw new Error("EIO")
          },
        }),
      ]) {
        const { watch, state } = handWatch()
        const all = yield* followLog({ file, check: () => ({ _tag: "ok", file }), reveal: false, watch, open }).pipe(Stream.runCollect)
        expect(all).toEqual([{ _tag: "unavailable", reason: "unreadable" }])
        expect(state.closed).toBe(true)
      }
    }))

  it.effect("a long transcript is read from near its end, saying there are older steps", () =>
    Effect.gen(function* () {
      const file = tempFile()
      fs.writeFileSync(file, Array.from({ length: 50 }, (_, i) => said(`m${i}`, `step ${i}`)).join(""))
      const { watch } = handWatch()
      const window = said("m48", "step 48").length * 2 + 5
      const first = yield* followLog({ file, check: () => ({ _tag: "ok", file }), reveal: false, watch, open: (f) => fileTail(f, { window }) }).pipe(
        Stream.runHead,
      )
      expect(first._tag === "Some" && first.value).toMatchObject({ _tag: "steps", reset: true, older: true, steps: [{ text: "step 48" }, { text: "step 49" }] })
    }))

  // CEL-126: on macOS under load, fs.watch is armed some time after it returns, and a write made before
  // then never raises an event. The watcher here drops every change until the test arms it, so the write
  // lands in that gap on purpose; the coarse re-check on the clock is what brings it in.
  it.effect("a write the watcher never reports (made before it was armed) still arrives at the next re-check, and quiet re-checks send nothing", () =>
    Effect.gen(function* () {
      const file = tempFile()
      fs.writeFileSync(file, said("m1", "Starting."))
      const { updates, reads, state } = yield* seamed(file)
      expect(yield* Queue.take(updates)).toMatchObject({ _tag: "steps", reset: true, steps: [{ text: "Starting." }] })
      expect(yield* Queue.take(reads)).toBe(1)

      // Written after the first read, while the watcher isn't armed yet: its event is lost.
      fs.appendFileSync(file, said("m2", "Lost in the gap."))
      state.fire()
      state.armed = true
      yield* TestClock.adjust(FOLLOW_RECHECK)
      expect(yield* Queue.take(updates)).toMatchObject({ _tag: "steps", reset: false, steps: [{ text: "Lost in the gap." }] })
      expect(yield* Queue.take(reads)).toBe(1)

      // Nothing new: the re-check reads nothing and sends nothing.
      yield* TestClock.adjust(FOLLOW_RECHECK)
      expect(yield* Queue.take(reads)).toBe(0)
      yield* Effect.yieldNow
      expect(yield* Queue.size(updates)).toBe(0)

      // The next step arrives once: the one after it is the next update, not a second copy.
      fs.appendFileSync(file, said("m3", "Seen by the watcher."))
      state.fire()
      expect(yield* Queue.take(updates)).toMatchObject({ _tag: "steps", reset: false, steps: [{ text: "Seen by the watcher." }] })
      fs.appendFileSync(file, said("m4", "And the next one."))
      state.fire()
      const next = yield* Queue.take(updates)
      expect(next._tag === "steps" && next.steps.map((step) => step.text)).toEqual(["And the next one."])
    }).pipe(Effect.scoped))

  it.effect("the re-check stops when the log is closed: no read, no update, no timer left behind", () =>
    Effect.gen(function* () {
      const file = tempFile()
      fs.writeFileSync(file, said("m1", "Starting."))
      const scope = yield* Scope.make()
      const { updates, reads, state, fiber } = yield* seamed(file).pipe(Scope.provide(scope))
      expect(yield* Queue.take(updates)).toMatchObject({ _tag: "steps", reset: true })
      expect(yield* Queue.take(reads)).toBe(1)

      yield* Scope.close(scope, Exit.void)
      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit) || Cause.hasInterruptsOnly(exit.cause)).toBe(true)
      expect(state.closed).toBe(true)
      const sleeps = state.sleeps
      yield* TestClock.adjust(Duration.times(FOLLOW_RECHECK, 3))
      fs.appendFileSync(file, said("m2", "Nobody is looking."))
      yield* Effect.yieldNow
      expect(yield* Queue.size(reads)).toBe(0)
      expect(yield* Queue.size(updates)).toBe(0)
      // A re-check fiber left running would have started another sleep.
      expect(state.sleeps).toBe(sleeps)
    }))

  it.effect("the first batch keeps only the newest steps, saying how many it left out", () =>
    Effect.gen(function* () {
      const file = tempFile()
      fs.writeFileSync(file, Array.from({ length: MAX_FIRST_STEPS + 7 }, (_, i) => said(`m${i}`, `step ${i}`)).join(""))
      const { next } = yield* follow(file)
      const first = yield* next
      expect(first._tag === "steps" && [first.steps.length, first.skipped, first.steps[0]?.text]).toEqual([MAX_FIRST_STEPS, 7, "step 7"])
    }).pipe(Effect.scoped))
})
