import { describe, expect, it } from "vitest"
import { createDeferredDecisions } from "./deferred.ts"

/** A clock the test moves by hand: nothing waits on real time. */
const fakeClock = () => {
  let now = 0
  let next = 0
  const timers = new Map<number, { at: number; run: () => void }>()
  return {
    clock: {
      now: () => now,
      set: (run: () => void, ms: number) => {
        timers.set(++next, { at: now + ms, run })
        return next
      },
      clear: (handle: unknown) => void timers.delete(handle as number),
    },
    /** Time passes; the timers that fell due run, in order. `throttled`: a hidden tab, whose timers don't run until it's seen again. */
    advance: (ms: number, throttled = false) => {
      now += ms
      if (throttled) return
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now) {
          timers.delete(id)
          t.run()
        }
      }
    },
    pending: () => timers.size,
  }
}

const entry = () => {
  const calls: string[] = []
  return { calls, send: () => void calls.push("send"), undone: () => void calls.push("undone") }
}

describe("deferred decisions: a decision waits in its window, then is sent exactly once (CEL-191)", () => {
  it("is sent when the window ends, not before", () => {
    const t = fakeClock()
    const d = createDeferredDecisions(t.clock)
    const e = entry()
    d.start("CEL-3", 5000, e)
    t.advance(4999)
    expect(e.calls).toEqual([])
    t.advance(1)
    expect(e.calls).toEqual(["send"])
    expect(d.has("CEL-3")).toBe(false)
  })

  it("undo inside the window sends nothing, ever", () => {
    const t = fakeClock()
    const d = createDeferredDecisions(t.clock)
    const e = entry()
    d.start("CEL-3", 5000, e)
    t.advance(4999)
    expect(d.undo("CEL-3")).toBe(true)
    t.advance(10_000)
    expect(e.calls).toEqual(["undone"])
    expect(t.pending()).toBe(0)
  })

  it("undo after the window ended finds nothing: the decision was sent and stays sent", () => {
    const t = fakeClock()
    const d = createDeferredDecisions(t.clock)
    const e = entry()
    d.start("CEL-3", 5000, e)
    t.advance(5000)
    expect(d.undo("CEL-3")).toBe(false)
    expect(e.calls).toEqual(["send"])
  })

  it("a second start on a row already waiting changes nothing: pressing A again doesn't send twice", () => {
    const t = fakeClock()
    const d = createDeferredDecisions(t.clock)
    const first = entry()
    const second = entry()
    expect(d.start("CEL-3", 5000, first)).toBe(true)
    expect(d.start("CEL-3", 5000, second)).toBe(false)
    t.advance(5000)
    expect(first.calls).toEqual(["send"])
    expect(second.calls).toEqual([])
  })

  it("two rows wait on their own windows", () => {
    const t = fakeClock()
    const d = createDeferredDecisions(t.clock)
    const a = entry()
    const b = entry()
    d.start("CEL-3", 5000, a)
    t.advance(2000)
    d.start("CEL-7", 5000, b)
    t.advance(3000)
    expect(a.calls).toEqual(["send"])
    expect(b.calls).toEqual([])
    d.undo("CEL-7")
    expect(b.calls).toEqual(["undone"])
  })

  it("a hidden tab's throttled timer is late: seen again, what is due is sent once, and the late timer doesn't send it twice", () => {
    const t = fakeClock()
    const d = createDeferredDecisions(t.clock)
    const e = entry()
    d.start("CEL-3", 5000, e)
    t.advance(7000, true)
    expect(e.calls).toEqual([])
    d.fireDue()
    expect(e.calls).toEqual(["send"])
    t.advance(60_000)
    expect(e.calls).toEqual(["send"])
  })

  it("fireDue leaves a window that hasn't ended", () => {
    const t = fakeClock()
    const d = createDeferredDecisions(t.clock)
    const e = entry()
    d.start("CEL-3", 5000, e)
    t.advance(1000, true)
    d.fireDue()
    expect(e.calls).toEqual([])
    expect(d.has("CEL-3")).toBe(true)
  })

  it("leaving the page sends every waiting decision at once, once: Lucas clicked Approve, so it isn't dropped", () => {
    const t = fakeClock()
    const d = createDeferredDecisions(t.clock)
    const a = entry()
    const b = entry()
    d.start("CEL-3", 5000, a)
    d.start("CEL-7", 5000, b)
    d.flushAll()
    d.flushAll()
    t.advance(60_000)
    expect(a.calls).toEqual(["send"])
    expect(b.calls).toEqual(["send"])
  })
})
