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
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import { followLog, type Watch } from "./followLog.ts"
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

  it.effect("the first batch keeps only the newest steps, saying how many it left out", () =>
    Effect.gen(function* () {
      const file = tempFile()
      fs.writeFileSync(file, Array.from({ length: MAX_FIRST_STEPS + 7 }, (_, i) => said(`m${i}`, `step ${i}`)).join(""))
      const { next } = yield* follow(file)
      const first = yield* next
      expect(first._tag === "steps" && [first.steps.length, first.skipped, first.steps[0]?.text]).toEqual([MAX_FIRST_STEPS, 7, "step 7"])
    }).pipe(Effect.scoped))
})
