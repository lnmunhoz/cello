import { describe, expect, it, vi } from "vitest"
import type { CelloDesktop } from "../lib/desktop.ts"
import {
  clampWidth,
  dragWidth,
  frameSrc,
  isEmbedded,
  isPlainClick,
  nextFrameState,
  openTarget,
  readWidth,
  refusesFraming,
  toViewerItem,
  VIEWER_WIDTH,
} from "./viewer.ts"

const ORIGIN = "http://localhost:4747"

describe("toViewerItem: what a URL is, for the viewer", () => {
  it("evidence on the server: a screenshot and a video by their kind, a text file as a page", () => {
    expect(toViewerItem({ url: "/attachments/a1", title: "The board", kind: "image" }, ORIGIN)).toEqual({
      url: "http://localhost:4747/attachments/a1",
      title: "The board",
      kind: "image",
    })
    expect(toViewerItem({ url: "/attachments/v1", title: "flow.mp4", kind: "video" }, ORIGIN)?.kind).toBe("video")
    expect(toViewerItem({ url: "/attachments/f1", title: "test-output.txt" }, ORIGIN)?.kind).toBe("page")
  })

  it("images and videos by their extension when nothing says what they are, on any site", () => {
    expect(toViewerItem({ url: "https://example.com/shots/board.PNG?raw=1" }, ORIGIN)?.kind).toBe("image")
    for (const ext of ["jpg", "jpeg", "gif", "webp", "avif", "svg"]) expect(toViewerItem({ url: `/x/a.${ext}` }, ORIGIN)?.kind).toBe("image")
    for (const ext of ["mp4", "webm", "mov", "m4v"]) expect(toViewerItem({ url: `https://cdn.dev/a.${ext}` }, ORIGIN)?.kind).toBe("video")
  })

  it("a Cello page (anything on the board's own origin) is a page", () => {
    expect(toViewerItem({ url: "/CEL/pages/release-notes", title: "Release notes" }, ORIGIN)).toEqual({
      url: "http://localhost:4747/CEL/pages/release-notes",
      title: "Release notes",
      kind: "page",
    })
    expect(toViewerItem({ url: "http://localhost:4747/review" }, ORIGIN)?.kind).toBe("page")
  })

  it("anything off the board's origin is external, a dev server on another port included", () => {
    expect(toViewerItem({ url: "https://claude.ai/artifact/abc" }, ORIGIN)?.kind).toBe("external")
    expect(toViewerItem({ url: "http://localhost:5173/" }, ORIGIN)?.kind).toBe("external")
  })

  it("titles: the one given, else the address without its scheme", () => {
    expect(toViewerItem({ url: "https://github.com/lnmunhoz/cello/pull/10" }, ORIGIN)?.title).toBe("github.com/lnmunhoz/cello/pull/10")
    expect(toViewerItem({ url: "https://a.dev/x", title: "  " }, ORIGIN)?.title).toBe("a.dev/x")
  })

  it("refuses anything that isn't a web page", () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,<b>x</b>", "mailto:me@x.dev", "", "#comments"]) {
      expect(toViewerItem({ url }, ORIGIN)).toBeNull()
    }
  })
})

describe("openTarget: the one place that decides where a page opens", () => {
  const bridge = () => ({ isDesktop: true as const, openPanel: vi.fn<CelloDesktop["openPanel"]>(), closePanel: vi.fn() })

  it("in the desktop app, the native browser panel, with an absolute URL", () => {
    const desktop = bridge()
    const show = vi.fn()
    expect(openTarget({ url: "/attachments/a1", title: "The board", kind: "image" }, { origin: ORIGIN, desktop, show })).toBe("desktop")
    expect(desktop.openPanel).toHaveBeenCalledWith("http://localhost:4747/attachments/a1", "The board")
    expect(show).not.toHaveBeenCalled()
  })

  it("in the desktop app, claude.ai artifacts and Cello pages go to the native panel too (Cello pages without the sidebar)", () => {
    const desktop = bridge()
    openTarget({ url: "https://claude.ai/artifact/abc", title: "Artifact" }, { origin: ORIGIN, desktop, show: vi.fn() })
    expect(desktop.openPanel).toHaveBeenLastCalledWith("https://claude.ai/artifact/abc", "Artifact")
    openTarget({ url: "/CEL/pages/notes" }, { origin: ORIGIN, desktop, show: vi.fn() })
    expect(desktop.openPanel).toHaveBeenLastCalledWith("http://localhost:4747/CEL/pages/notes?embed=1", "localhost:4747/CEL/pages/notes")
  })

  it("in a browser, the web viewer panel", () => {
    const show = vi.fn()
    expect(openTarget({ url: "https://claude.ai/artifact/abc" }, { origin: ORIGIN, desktop: undefined, show })).toBe("viewer")
    expect(show).toHaveBeenCalledWith({ url: "https://claude.ai/artifact/abc", title: "claude.ai/artifact/abc", kind: "external" })
  })

  it("from a Cello page inside the web viewer, the board's own viewer", () => {
    const show = vi.fn()
    const parent = vi.fn()
    expect(openTarget({ url: "/attachments/a1", kind: "image" }, { origin: ORIGIN, desktop: undefined, parent, show })).toBe("parent")
    expect(parent).toHaveBeenCalledWith({ url: "http://localhost:4747/attachments/a1", title: "localhost:4747/attachments/a1", kind: "image" })
    expect(show).not.toHaveBeenCalled()
  })

  it("nowhere for something that isn't a web page, so the link does what it would anyway", () => {
    const desktop = bridge()
    const show = vi.fn()
    expect(openTarget({ url: "mailto:me@x.dev" }, { origin: ORIGIN, desktop, show })).toBeNull()
    expect(openTarget({ url: "javascript:alert(1)" }, { origin: ORIGIN, desktop: undefined, show })).toBeNull()
    expect(desktop.openPanel).not.toHaveBeenCalled()
    expect(show).not.toHaveBeenCalled()
  })
})

describe("refusesFraming: sites known to forbid being shown in an iframe", () => {
  it("claude.ai and GitHub, subdomains included", () => {
    expect(refusesFraming("https://claude.ai/artifact/abc")).toBe(true)
    expect(refusesFraming("https://github.com/lnmunhoz/cello/pull/10")).toBe(true)
    expect(refusesFraming("https://gist.github.com/x/1")).toBe(true)
  })

  it("not other sites, which get an iframe attempt", () => {
    expect(refusesFraming("https://example.com/")).toBe(false)
    expect(refusesFraming("https://notgithub.com/")).toBe(false)
    expect(refusesFraming("not a url")).toBe(false)
  })
})

describe("frameSrc: Cello pages in a panel show without the sidebar", () => {
  it("adds embed=1 to the board's own pages, keeping their search and hash", () => {
    expect(frameSrc("http://localhost:4747/CEL/pages/notes", ORIGIN)).toBe("http://localhost:4747/CEL/pages/notes?embed=1")
    expect(frameSrc("http://localhost:4747/CEL/issues?layout=list#x", ORIGIN)).toBe("http://localhost:4747/CEL/issues?layout=list&embed=1#x")
  })

  it("leaves served files and other sites alone", () => {
    expect(frameSrc("http://localhost:4747/attachments/f1", ORIGIN)).toBe("http://localhost:4747/attachments/f1")
    expect(frameSrc("https://example.com/", ORIGIN)).toBe("https://example.com/")
  })
})

describe("isEmbedded", () => {
  const top = {}
  it("inside a frame, or asked for with ?embed", () => {
    expect(isEmbedded({ self: {}, top, search: "" })).toBe(true)
    expect(isEmbedded({ self: top, top, search: "?layout=list&embed=1" })).toBe(true)
  })
  it("not on its own", () => {
    expect(isEmbedded({ self: top, top, search: "?layout=list" })).toBe(false)
  })
})

describe("isPlainClick: a plain click opens the viewer; a modified one does what the browser would", () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false }
  it("a left click with no modifier keys", () => expect(isPlainClick(click)).toBe(true))
  it("not ⌘/Ctrl/Shift/Alt-click, a middle click, or one already handled", () => {
    for (const extra of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
      expect(isPlainClick({ ...click, ...extra })).toBe(false)
    }
  })
})

describe("the viewer's width", () => {
  it("starts as wide as the task panel, so the board keeps its width when one replaces the other", () => {
    expect(VIEWER_WIDTH.initial).toBe(560)
    expect(readWidth(null)).toBe(560)
    expect(readWidth("abc")).toBe(560)
    expect(readWidth("720")).toBe(720)
  })

  it("stays between its minimum and what leaves the page beside it usable", () => {
    expect(clampWidth(700, 1200)).toBe(700)
    expect(clampWidth(100, 1200)).toBe(VIEWER_WIDTH.min)
    expect(clampWidth(1100, 1200)).toBe(1200 - VIEWER_WIDTH.minPage)
    expect(clampWidth(500, 500)).toBe(VIEWER_WIDTH.min)
  })

  it("dragging its left edge left makes it wider", () => {
    expect(dragWidth({ width: 560, x: 800 }, 600, 1200)).toBe(760)
    expect(dragWidth({ width: 560, x: 800 }, 900, 1200)).toBe(460)
    expect(dragWidth({ width: 560, x: 800 }, 0, 1200)).toBe(1200 - VIEWER_WIDTH.minPage)
  })
})

describe("nextFrameState: whether an external page showed in the iframe", () => {
  it("shown once it loads", () => expect(nextFrameState("loading", "load")).toBe("shown"))
  it("blocked when it errors or takes too long", () => {
    expect(nextFrameState("loading", "error")).toBe("blocked")
    expect(nextFrameState("loading", "timeout")).toBe("blocked")
  })
  it("a late timeout doesn't hide a page that loaded", () => expect(nextFrameState("shown", "timeout")).toBe("shown"))
})
