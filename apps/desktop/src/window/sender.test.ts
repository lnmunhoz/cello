import { describe, expect, it } from "vitest"
import { isBoardPage } from "./sender.ts"

const BOARD = "http://127.0.0.1:4747"

describe("isBoardPage: who may send the app's settings commands (board, updates; CEL-149)", () => {
  it("is the board's own page, in the window's top frame", () => {
    expect(isBoardPage({ url: `${BOARD}/settings`, top: true }, BOARD)).toBe(true)
  })

  it("is never a frame inside it, even one of the board's own pages (the side panel's viewer)", () => {
    expect(isBoardPage({ url: `${BOARD}/CEL/pages/notes?embed=1`, top: false }, BOARD)).toBe(false)
  })

  it("is never another page: the starting message, another origin, or before the board loaded", () => {
    expect(isBoardPage({ url: "data:text/html,Starting", top: true }, BOARD)).toBe(false)
    expect(isBoardPage({ url: "http://127.0.0.1:4748/settings", top: true }, BOARD)).toBe(false)
    expect(isBoardPage({ url: `${BOARD}/settings`, top: true }, null)).toBe(false)
    expect(isBoardPage(null, BOARD)).toBe(false)
  })
})
