import { describe, expect, it } from "vitest"
import { DEFAULT_UNDO_SECONDS, readUndoWindow, undoStored, UNDO_CHOICES } from "./undoWindow.ts"

describe("the undo window setting (CEL-191)", () => {
  it("is on, 5 seconds, until it's changed", () => {
    expect(DEFAULT_UNDO_SECONDS).toBe(5)
    expect(readUndoWindow(null)).toEqual({ on: true, seconds: 5 })
  })

  it("off means decisions are sent at once, but keeps the length for turning it back on", () => {
    expect(readUndoWindow("off")).toEqual({ on: false, seconds: 5 })
    expect(readUndoWindow("off:10")).toEqual({ on: false, seconds: 10 })
  })

  it("reads a length in seconds, within 1 to 60; anything else is the default", () => {
    expect(readUndoWindow("10")).toEqual({ on: true, seconds: 10 })
    expect(readUndoWindow("1")).toEqual({ on: true, seconds: 1 })
    expect(readUndoWindow("60")).toEqual({ on: true, seconds: 60 })
    for (const bad of ["0", "-3", "61", "abc", "", "2.5", "NaN"]) expect(readUndoWindow(bad)).toEqual({ on: true, seconds: 5 })
  })

  it("writes back what it reads", () => {
    for (const value of [{ on: true, seconds: 3 }, { on: false, seconds: 15 }, { on: true, seconds: 5 }]) expect(readUndoWindow(undoStored(value))).toEqual(value)
  })

  it("offers lengths that are valid", () => {
    for (const seconds of UNDO_CHOICES) expect(readUndoWindow(String(seconds))).toEqual({ on: true, seconds })
  })
})
