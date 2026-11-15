import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { RenderSkipped, RenderTimeout, renderQueue } from "./renderQueue.ts"

describe("renderQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("runs renders one at a time, in order", async () => {
    const run = renderQueue(10_000)
    const order: string[] = []
    let finishFirst = () => {}
    const first = run(() => new Promise<string>((resolve) => (finishFirst = () => resolve("a"))).then((v) => (order.push(v), v)))
    const second = run(async () => (order.push("b"), "b"))
    await vi.advanceTimersByTimeAsync(0)
    expect(order).toEqual([])
    finishFirst()
    expect(await first).toBe("a")
    expect(await second).toBe("b")
    expect(order).toEqual(["a", "b"])
  })

  it("gives up on a render that never settles, so the next one still runs", async () => {
    const run = renderQueue(10_000)
    const stuck = run(() => new Promise<string>(() => {}))
    const next = run(async () => "next")
    const failed = expect(stuck).rejects.toBeInstanceOf(RenderTimeout)
    await vi.advanceTimersByTimeAsync(10_000)
    await failed
    expect(await next).toBe("next")
  })

  it("moves on after a render that fails", async () => {
    const run = renderQueue(10_000)
    const bad = run(() => Promise.reject(new Error("Parse error")))
    await expect(bad).rejects.toThrow("Parse error")
    expect(await run(async () => "ok")).toBe("ok")
  })

  it("skips a queued render nobody wants any more (unmounted, or the theme changed)", async () => {
    const run = renderQueue(10_000)
    let finishFirst = () => {}
    const first = run(() => new Promise<void>((resolve) => (finishFirst = resolve)))
    let wanted = true
    const task = vi.fn(async () => "svg")
    const stale = run(task, () => wanted)
    wanted = false
    await vi.advanceTimersByTimeAsync(0)
    finishFirst()
    await first
    await expect(stale).rejects.toBeInstanceOf(RenderSkipped)
    expect(task).not.toHaveBeenCalled()
  })
})
