import { describe, expect, it } from "vitest"
import { isUnread, markSeen, parseSeen } from "./seen.ts"

describe("parseSeen: what this device remembers having opened (CEL-190)", () => {
  it("reads a saved map of task key to the packet last opened", () => {
    expect(parseSeen('{"CEL-3":"r1","THAI-2":"r9"}')).toEqual({ "CEL-3": "r1", "THAI-2": "r9" })
  })

  it("nothing saved, or something that isn't a map of words, is nothing seen", () => {
    expect(parseSeen(null)).toEqual({})
    expect(parseSeen("")).toEqual({})
    expect(parseSeen("not json")).toEqual({})
    expect(parseSeen("[1,2]")).toEqual({})
    expect(parseSeen("null")).toEqual({})
    expect(parseSeen('{"CEL-3":4,"CEL-4":"r2"}')).toEqual({ "CEL-4": "r2" })
  })
})

describe("isUnread: a packet that changed since it was last opened", () => {
  it("is unread until its packet has been opened", () => {
    expect(isUnread({ id: "r1" }, {}, "CEL-3")).toBe(true)
    expect(isUnread({ id: "r1" }, { "CEL-3": "r1" }, "CEL-3")).toBe(false)
    expect(isUnread({ id: "r1" }, { "CEL-3": "r1" }, "CEL-4")).toBe(true)
  })

  it("is unread again when the task has a new packet (sent back, then handed in again)", () => {
    expect(isUnread({ id: "r2" }, { "CEL-3": "r1" }, "CEL-3")).toBe(true)
  })

  it("a task moved to In Review by hand has no packet, so nothing to be unread", () => {
    expect(isUnread(null, {}, "CEL-3")).toBe(false)
  })
})

describe("markSeen: opening a packet", () => {
  it("notes the packet opened for its task, and keeps the rest", () => {
    expect(markSeen({ "CEL-3": "r1" }, "THAI-2", "r9")).toEqual({ "CEL-3": "r1", "THAI-2": "r9" })
    expect(markSeen({ "CEL-3": "r1" }, "CEL-3", "r2")).toEqual({ "CEL-3": "r2" })
  })

  it("is the same map when it is already noted, so nothing is written", () => {
    const seen = { "CEL-3": "r1" }
    expect(markSeen(seen, "CEL-3", "r1")).toBe(seen)
  })

  it("keeps the newest 200 tasks, so the saved map doesn't grow for ever", () => {
    const seen = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`CEL-${i}`, `r${i}`]))
    const next = markSeen(seen, "CEL-999", "r999")
    expect(Object.keys(next)).toHaveLength(200)
    expect(next["CEL-999"]).toBe("r999")
    expect(next["CEL-0"]).toBeUndefined()
    expect(next["CEL-1"]).toBe("r1")
  })
})
