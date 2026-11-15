import { describe, expect, it } from "vitest"
import { galleryOf, zoomable, zoomableItem } from "./gallery.ts"
import type { ModalItem } from "./imageModal.ts"

/** An element's dataset as the browser builds it from `zoomable`'s attributes ("data-url" → url). */
const datasetOf = (item: ModalItem) =>
  Object.fromEntries(Object.entries(zoomable(item)).map(([name, value]) => [name.slice("data-".length), value]))

const board = { url: "/attachments/s1", title: "The board", name: "board.png" }
const flow = { kind: "diagram", source: "flowchart TD\n  A[Start] --> B[End]", title: "Diagram: Start" } as const
const after = { url: "after.png", title: "After" }

describe("zoomable elements", () => {
  it("an image or a diagram written as data attributes reads back as the same item", () => {
    expect(zoomableItem(datasetOf(board))).toEqual(board)
    expect(zoomableItem(datasetOf(flow))).toEqual(flow)
    expect(zoomableItem(datasetOf(after))).toEqual(after)
  })

  it("an element that isn't zoomable, or is missing what it opens, is no item", () => {
    expect(zoomableItem({})).toBeNull()
    expect(zoomableItem({ zoomable: "image", title: "No address" })).toBeNull()
    expect(zoomableItem({ zoomable: "diagram", title: "Diagram" })).toBeNull()
    expect(zoomableItem({ zoomable: "video", url: "/attachments/v1", title: "A video" })).toBeNull()
  })
})

describe("a page's or packet's gallery", () => {
  it("is every image and diagram in document order, opened at the one clicked", () => {
    const entries = [board, flow, after].map(datasetOf)
    expect(galleryOf(entries, 1)).toEqual({ items: [board, flow, after], index: 1 })
    expect(galleryOf(entries, 2)).toEqual({ items: [board, flow, after], index: 2 })
  })

  it("skips what can't open, keeping the clicked one in place", () => {
    const entries = [datasetOf(board), { zoomable: "image", title: "Broken" }, datasetOf(flow)]
    expect(galleryOf(entries, 2)).toEqual({ items: [board, flow], index: 1 })
  })

  it("is empty when nothing in it can open", () => {
    expect(galleryOf([{}], 0)).toEqual({ items: [], index: 0 })
  })
})
