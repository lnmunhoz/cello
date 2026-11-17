import { describe, expect, it } from "vitest"
import { backOf, closeMove, isHop, MAX_HOPS, recordMove, sameSpot, sideOf, type Hops, type Spot } from "./panelHistory.ts"

const board: Spot = { pathname: "/FE/issues", search: {} }
const task = (n: number, search: Record<string, unknown> = {}): Spot => ({ pathname: `/FE/${n}`, search })
const PAGE = "/FE/pages/saved-library"
/** Task 73 in the main area, its page in the side panel. */
const taskWithPage = task(73, { viewer: PAGE })

describe("what the side panel shows", () => {
  it("the viewer's item when it's open, over anything", () => {
    expect(sideOf(taskWithPage)).toEqual({ type: "viewer", url: PAGE })
    expect(sideOf({ pathname: "/FE/docs", search: { viewer: PAGE } })).toEqual({ type: "viewer", url: PAGE })
  })

  it("a task in the viewer, on a page that isn't its board (CEL-141), is that task", () => {
    expect(sideOf({ pathname: "/review", search: { viewer: "/THAI/96" } })).toEqual({ type: "task", key: "THAI-96" })
    expect(sideOf(task(73, { viewer: "/THAI/96" }))).toEqual({ type: "task", key: "THAI-96" })
    // Another site's address that looks like one is still that site.
    expect(sideOf({ pathname: "/review", search: { viewer: "https://example.com/THAI/96" } })).toEqual({ type: "viewer", url: "https://example.com/THAI/96" })
  })

  it("else the open task docked beside the board; nothing for a full page or no task", () => {
    expect(sideOf(task(73))).toEqual({ type: "task", key: "FE-73" })
    expect(sideOf(task(73, { view: "full" }))).toBeNull()
    expect(sideOf(board)).toBeNull()
    expect(sideOf({ pathname: "/FE/pages/notes", search: {} })).toBeNull()
  })
})

describe("a hop: the side panel goes from one thing to another, from a click inside it", () => {
  it("a page opened from the task in the panel, the task from the page's TASKS chip, a linked task from a comment", () => {
    expect(isHop(task(73), taskWithPage, true)).toBe(true)
    expect(isHop(taskWithPage, task(73), true)).toBe(true)
    expect(isHop(task(73), task(70), true)).toBe(true)
    expect(isHop(taskWithPage, task(73, { viewer: "/FE/pages/other" }), true)).toBe(true)
  })

  it("on the Review page: a task in the side panel to another task linked in its comment, or to its page (CEL-141)", () => {
    const review = (viewer: string): Spot => ({ pathname: "/review", search: { viewer } })
    expect(isHop(review("/THAI/96"), review("/THAI/102"), true)).toBe(true)
    expect(isHop(review("/THAI/96"), review("/THAI/pages/plan"), true)).toBe(true)
    expect(isHop({ pathname: "/review", search: {} }, review("/THAI/96"), false)).toBe(false)
  })

  it("not from the board, the Docs tab or a `cello open` link: nothing was in the panel, or the click wasn't in it", () => {
    expect(isHop(board, task(73), true)).toBe(false)
    expect(isHop({ pathname: "/FE/docs", search: {} }, { pathname: "/FE/docs", search: { viewer: PAGE } }, false)).toBe(false)
    expect(isHop(task(73), taskWithPage, false)).toBe(false)
  })

  it("not when the panel empties (expanding the task, closing it) or shows the same thing", () => {
    expect(isHop(task(73), task(73, { view: "full" }), true)).toBe(false)
    expect(isHop(task(73), board, true)).toBe(false)
    expect(isHop(taskWithPage, task(73, { view: "full", viewer: PAGE }), true)).toBe(false)
  })
})

describe("same spot: the same address, whatever the order of its params", () => {
  it("compares the path and the params, ignoring undefined ones", () => {
    expect(sameSpot(task(73, { a: 1, b: "x" }), task(73, { b: "x", a: 1, c: undefined }))).toBe(true)
    expect(sameSpot(task(73), task(70))).toBe(false)
    expect(sameSpot(task(73), task(73, { view: "full" }))).toBe(false)
  })
})

const at = (key: string, spot: Spot) => ({ key, spot })

describe("the Back stack: one entry per history entry reached by a hop (CEL-117)", () => {
  it("records where a hop came from, so Back can return there", () => {
    const hops = recordMove({}, { type: "PUSH", from: at("a", task(73)), to: at("b", taskWithPage), fromPanel: true })
    expect(backOf(hops, "b")).toEqual(task(73))
    expect(backOf(hops, "a")).toBeUndefined()
  })

  it("through several hops: page → its TASKS chip → another task, and back each step", () => {
    let hops: Hops = {}
    hops = recordMove(hops, { type: "PUSH", from: at("1", task(73)), to: at("2", taskWithPage), fromPanel: true })
    hops = recordMove(hops, { type: "PUSH", from: at("2", taskWithPage), to: at("3", task(73)), fromPanel: true })
    hops = recordMove(hops, { type: "PUSH", from: at("3", task(73)), to: at("4", task(70)), fromPanel: true })
    expect(backOf(hops, "4")).toEqual(task(73))
    // Back (the browser's own history) keeps every record, so Forward and Back again still work.
    const backed = recordMove(hops, { type: "BACK", from: at("4", task(70)), to: at("3", task(73)), fromPanel: false })
    expect(backed).toBe(hops)
    expect(backOf(backed, "3")).toEqual(taskWithPage)
    expect(backOf(backed, "2")).toEqual(task(73))
    expect(backOf(backed, "1")).toBeUndefined()
  })

  it("a push that isn't a hop records nothing", () => {
    expect(recordMove({}, { type: "PUSH", from: at("a", board), to: at("b", task(73)), fromPanel: true })).toEqual({})
  })

  it("a replace (a filter change, a version picked) keeps the entry's way back while the panel still shows something", () => {
    const hops = recordMove({}, { type: "PUSH", from: at("a", task(73)), to: at("b", taskWithPage), fromPanel: true })
    const replaced = recordMove(hops, { type: "REPLACE", from: at("b", taskWithPage), to: at("c", task(73, { viewer: `${PAGE}?version=2` })), fromPanel: false })
    expect(backOf(replaced, "c")).toEqual(task(73))
    expect(backOf(replaced, "b")).toBeUndefined()
    const emptied = recordMove(hops, { type: "REPLACE", from: at("b", taskWithPage), to: at("c", task(73, { view: "full" })), fromPanel: false })
    expect(backOf(emptied, "c")).toBeUndefined()
  })

  it("keeps only the newest records", () => {
    let hops: Hops = {}
    for (let i = 0; i < MAX_HOPS + 10; i++) hops = recordMove(hops, { type: "PUSH", from: at(`k${i}`, task(i + 1)), to: at(`k${i + 1}`, task(i + 2)), fromPanel: true })
    expect(Object.keys(hops)).toHaveLength(MAX_HOPS)
    expect(backOf(hops, `k${MAX_HOPS + 10}`)).toEqual(task(MAX_HOPS + 10))
    expect(backOf(hops, "k1")).toBeUndefined()
  })
})

describe("closing the viewer", () => {
  it("goes back when the entry before is exactly the layout without it: the task back in the panel", () => {
    const hops = recordMove({}, { type: "PUSH", from: at("a", task(73)), to: at("b", taskWithPage), fromPanel: true })
    expect(closeMove(hops, "b", taskWithPage)).toBe("back")
  })

  it("an already expanded task keeps its full page", () => {
    const full = task(73, { view: "full" })
    const hops = recordMove({}, { type: "PUSH", from: at("a", full), to: at("b", task(73, { view: "full", viewer: PAGE })), fromPanel: true })
    expect(closeMove(hops, "b", task(73, { view: "full", viewer: PAGE }))).toBe("replace")
  })

  it("otherwise replaces the entry with the layout without it, so it never leaves a Back to what was just closed", () => {
    expect(closeMove({}, "b", taskWithPage)).toBe("replace")
    const hops = recordMove({}, { type: "PUSH", from: at("a", taskWithPage), to: at("b", task(73, { viewer: "/attachments/f1" })), fromPanel: true })
    expect(closeMove(hops, "b", task(73, { viewer: "/attachments/f1" }))).toBe("replace")
  })
})
