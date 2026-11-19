import { describe, expect, it } from "vitest"
import { createDeferredDecisions, inTurn } from "./deferred.ts"

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
  return { calls, send: () => void calls.push("send"), undone: () => void calls.push("undone"), failed: () => void calls.push("failed") }
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

describe("deferred decisions: what is waiting can be watched (CEL-191)", () => {
  it("tells its listeners when a window starts, is undone or ends, and keeps the same keys string between", () => {
    const t = fakeClock()
    const d = createDeferredDecisions(t.clock)
    const seen: string[] = []
    d.subscribe(() => seen.push(d.keys()))
    d.start("THAI-2", 5000, entry())
    d.start("CEL-3", 5000, entry())
    d.undo("THAI-2")
    t.advance(5000)
    // Sent, but not answered: the task is still held. Answered: free.
    expect(seen).toEqual(["THAI-2", "CEL-3 THAI-2", "CEL-3", "CEL-3"])
    d.settled("CEL-3")
    expect(seen.at(-1)).toBe("")
    expect(d.keys()).toBe("")
  })
})

describe("inTurn: sends go one after another (CEL-191)", () => {
  it("the second starts only once the first has answered, even when the first fails", async () => {
    const order: string[] = []
    let release = () => {}
    const first = inTurn(
      () =>
        new Promise<string>((_, reject) => {
          order.push("first starts")
          release = () => reject(new Error("refused"))
        }),
    )
    const second = inTurn(async () => {
      order.push("second starts")
      return "ok"
    })
    await Promise.resolve()
    expect(order).toEqual(["first starts"])
    release()
    await expect(first).rejects.toThrow("refused")
    await expect(second).resolves.toBe("ok")
    expect(order).toEqual(["first starts", "second starts"])
  })
})

describe("deferred decisions: one that throws strands nothing (CEL-191)", () => {
  it("a send that throws is that row's failure: the entry hears it, the task is free, the other decisions still go", () => {
    const t = fakeClock()
    const d = createDeferredDecisions(t.clock)
    const bad = { ...entry(), send: () => { throw new Error("boom") } }
    const failures: unknown[] = []
    const first = { ...bad, failed: (error: unknown) => void failures.push(error) }
    const second = entry()
    d.start("CEL-3", 5000, first)
    d.start("CEL-7", 5000, second)
    d.flushAll()
    expect(failures).toHaveLength(1)
    expect((failures[0] as Error).message).toBe("boom")
    expect(second.calls).toEqual(["send"])
    expect(d.keys()).toBe("CEL-7")
  })

  it("the same when the window ends and when the tab is seen again", () => {
    const t = fakeClock()
    const d = createDeferredDecisions(t.clock)
    const failed: string[] = []
    const thrower = (name: string) => ({ ...entry(), send: () => { throw new Error(name) }, failed: () => void failed.push(name) })
    const ok = entry()
    d.start("CEL-3", 5000, thrower("a"))
    d.start("CEL-7", 5000, ok)
    t.advance(6000, true)
    d.fireDue()
    expect(failed).toEqual(["a"])
    expect(ok.calls).toEqual(["send"])
    expect(d.has("CEL-3")).toBe(false)
  })
})

describe("deferred decisions: how they are sent, and who is held (CEL-191)", () => {
  it("the entry is told whether the window ended, the page was left, or the page is going", () => {
    const t = fakeClock()
    const d = createDeferredDecisions(t.clock)
    const hows: string[] = []
    const seeing = () => ({ ...entry(), send: (how: string) => void hows.push(how) })
    d.start("CEL-3", 5000, seeing())
    d.start("CEL-7", 5000, seeing())
    d.start("CEL-9", 5000, seeing())
    t.advance(5000)
    expect(hows).toEqual(["window", "window", "window"])
    for (const key of ["CEL-3", "CEL-7", "CEL-9"]) d.settled(key)
    d.start("CEL-3", 5000, seeing())
    d.flushAll()
    d.settled("CEL-3")
    d.start("CEL-3", 5000, seeing())
    d.flushAll("going")
    expect(hows.slice(3)).toEqual(["leaving", "going"])
  })

  it("a task being sent is held until its answer, and can't start another decision meanwhile", () => {
    const t = fakeClock()
    const d = createDeferredDecisions(t.clock)
    d.start("CEL-3", 5000, entry())
    t.advance(5000)
    expect(d.has("CEL-3")).toBe(false)
    expect(d.keys()).toBe("CEL-3")
    expect(d.start("CEL-3", 5000, entry())).toBe(false)
    d.settled("CEL-3")
    expect(d.keys()).toBe("")
    expect(d.start("CEL-3", 5000, entry())).toBe(true)
  })
})
