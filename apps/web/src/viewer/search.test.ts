import { describe, expect, it } from "vitest"
import { keepViewer, parseViewerSearch, viewerItemOf, viewerSearchOf, withoutViewer } from "./search.ts"
import { toViewerItem } from "./viewer.ts"

const ORIGIN = "http://localhost:4747"

describe("the viewer's item in the URL (CEL-117), so a reload and browser back/forward keep it", () => {
  it("a Cello page is just its path on the board", () => {
    const item = toViewerItem({ url: "/CEL/pages/notes", title: "Notes" }, ORIGIN)!
    expect(viewerSearchOf(item, ORIGIN)).toEqual({ viewer: "/CEL/pages/notes", viewerTitle: "Notes" })
  })

  it("leaves out what the address already says: the kind and the title it would get anyway", () => {
    const item = toViewerItem({ url: "/CEL/pages/notes" }, ORIGIN)!
    expect(viewerSearchOf(item, ORIGIN)).toEqual({ viewer: "/CEL/pages/notes" })
    expect(viewerSearchOf(toViewerItem({ url: "https://example.com/a.png" }, ORIGIN)!, ORIGIN)).toEqual({ viewer: "https://example.com/a.png" })
  })

  it("keeps a page's version and section", () => {
    const item = toViewerItem({ url: "/CEL/pages/notes?version=2#next" }, ORIGIN)!
    expect(viewerSearchOf(item, ORIGIN).viewer).toBe("/CEL/pages/notes?version=2#next")
  })

  it("evidence keeps the kind, title and file name nothing in its address says", () => {
    const shot = toViewerItem({ url: "/attachments/a1", title: "The board", kind: "image" }, ORIGIN)!
    expect(viewerSearchOf(shot, ORIGIN)).toEqual({ viewer: "/attachments/a1", viewerKind: "image", viewerTitle: "The board" })
    const log = toViewerItem({ url: "/attachments/f1", title: "Test output", kind: "text", name: "test-output.txt" }, ORIGIN)!
    expect(viewerSearchOf(log, ORIGIN)).toEqual({ viewer: "/attachments/f1", viewerTitle: "Test output", viewerName: "test-output.txt" })
  })

  it("reads back the same item", () => {
    for (const target of [
      { url: "/CEL/pages/notes?version=2#next", title: "Notes" },
      { url: "/attachments/a1", title: "The board", kind: "image" as const },
      { url: "/attachments/f1", title: "Test output", kind: "text" as const, name: "test-output.txt" },
      { url: "https://example.com/preview" },
      { url: "http://localhost:4747/review" },
    ]) {
      const item = toViewerItem(target, ORIGIN)!
      expect(viewerItemOf(viewerSearchOf(item, ORIGIN), ORIGIN)).toEqual(item)
    }
  })

  it("nothing open without `viewer`, or with an address that isn't a web page", () => {
    expect(viewerItemOf({}, ORIGIN)).toBeNull()
    expect(viewerItemOf({ viewer: "javascript:alert(1)" }, ORIGIN)).toBeNull()
  })

  it("validates the search: strings only, a known kind only", () => {
    expect(parseViewerSearch({ viewer: "/CEL/pages/notes", viewerKind: "video", viewerTitle: "Flow", viewerName: "flow.mp4", view: "full" })).toEqual({
      viewer: "/CEL/pages/notes",
      viewerKind: "video",
      viewerTitle: "Flow",
      viewerName: "flow.mp4",
    })
    expect(parseViewerSearch({ viewer: 3, viewerKind: "page", viewerTitle: "" })).toEqual({})
    expect(parseViewerSearch({ viewerKind: "image" })).toEqual({})
  })

  it("closing removes every viewer param and keeps the rest", () => {
    expect(withoutViewer({ view: "full", viewer: "/a", viewerKind: "image", viewerTitle: "A", viewerName: "a.png" })).toEqual({
      view: "full",
      viewer: undefined,
      viewerKind: undefined,
      viewerTitle: undefined,
      viewerName: undefined,
    })
  })

  it("a page that sets its own search (the Review page's open packet) keeps the viewer beside it", () => {
    expect(keepViewer({ open: "CEL-1", viewer: "/a", viewerTitle: "A", layout: "list" })).toEqual({ viewer: "/a", viewerTitle: "A" })
    expect(keepViewer({ open: "CEL-1" })).toEqual({})
  })
})
