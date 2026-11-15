import { describe, expect, it, vi } from "vitest"
import type { CelloDesktop } from "../lib/desktop.ts"
import { clampWidth, readWidth } from "../lib/resize.ts"
import {
  fullPageHref,
  isEmbedded,
  isPlainClick,
  nextFrameState,
  openRoute,
  openTarget,
  openTaskFrom,
  pageRef,
  refusesFraming,
  taskRoute,
  toViewerItem,
  VIEWER_WIDTH,
  withVersion,
  type OpenEnv,
  type OpenTarget,
} from "./viewer.ts"

const ORIGIN = "http://localhost:4747"

describe("toViewerItem: what a URL is, for the viewer", () => {
  it("evidence on the server: a screenshot and a video by their kind, a text file by its kind and name", () => {
    expect(toViewerItem({ url: "/attachments/a1", title: "The board", kind: "image" }, ORIGIN)).toEqual({
      url: "http://localhost:4747/attachments/a1",
      title: "The board",
      kind: "image",
    })
    expect(toViewerItem({ url: "/attachments/v1", title: "flow.mp4", kind: "video" }, ORIGIN)?.kind).toBe("video")
    expect(toViewerItem({ url: "/attachments/f1", title: "Test output", kind: "text", name: "test-output.txt" }, ORIGIN)).toEqual({
      url: "http://localhost:4747/attachments/f1",
      title: "Test output",
      kind: "text",
      name: "test-output.txt",
    })
  })

  it("a stored file nothing describes is text (the server stores only images, videos and text); the text view checks its type", () => {
    expect(toViewerItem({ url: "/attachments/f1" }, ORIGIN)?.kind).toBe("text")
    expect(toViewerItem({ url: "http://localhost:4747/attachments/f1#L3" }, ORIGIN)?.kind).toBe("text")
  })

  it("a text file on the board's origin by its extension: logs, transcripts, markdown, JSON, CSV", () => {
    for (const ext of ["txt", "log", "out", "md", "json", "csv", "cast"]) expect(toViewerItem({ url: `/files/run.${ext}` }, ORIGIN)?.kind).toBe("text")
  })

  it("a text file on another site is just a site (it can't be read from here)", () => {
    expect(toViewerItem({ url: "https://raw.example.com/run.log" }, ORIGIN)?.kind).toBe("external")
  })

  it("images and videos by their extension when nothing says what they are, on any site", () => {
    expect(toViewerItem({ url: "https://example.com/shots/board.PNG?raw=1" }, ORIGIN)?.kind).toBe("image")
    for (const ext of ["jpg", "jpeg", "gif", "webp", "avif", "svg"]) expect(toViewerItem({ url: `/x/a.${ext}` }, ORIGIN)?.kind).toBe("image")
    for (const ext of ["mp4", "webm", "mov", "m4v"]) expect(toViewerItem({ url: `https://cdn.dev/a.${ext}` }, ORIGIN)?.kind).toBe("video")
  })

  it("a Cello page (anything else on the board's own origin) is a page", () => {
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

  it("titles: the one given, else the file name, else the address without its scheme", () => {
    expect(toViewerItem({ url: "https://github.com/lnmunhoz/cello/pull/10" }, ORIGIN)?.title).toBe("github.com/lnmunhoz/cello/pull/10")
    expect(toViewerItem({ url: "https://a.dev/x", title: "  " }, ORIGIN)?.title).toBe("a.dev/x")
    expect(toViewerItem({ url: "/attachments/f1", name: "run.log" }, ORIGIN)?.title).toBe("run.log")
  })

  it("refuses anything that isn't a web page", () => {
    for (const url of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,<b>x</b>", "mailto:me@x.dev", "", "#comments"]) {
      expect(toViewerItem({ url }, ORIGIN)).toBeNull()
    }
  })
})

describe("openRoute: the one rule for where an open goes (CEL-60)", () => {
  const route = (target: OpenTarget, where: { desktop?: boolean; framed?: boolean } = {}) => {
    const item = toViewerItem(target, ORIGIN)
    return item && openRoute(item, target, { desktop: where.desktop ?? false, framed: where.framed ?? false })
  }

  it("an image link opens in the image modal, in the app and in a browser", () => {
    for (const desktop of [true, false]) {
      expect(route({ url: "/x/board.png" }, { desktop })).toBe("modal")
      expect(route({ url: "https://example.com/shot.jpg" }, { desktop })).toBe("modal")
    }
  })

  it("Open in viewer moves an image to the side panel", () => {
    for (const desktop of [true, false]) expect(route({ url: "/attachments/a1", kind: "image", place: "viewer" }, { desktop })).toBe("panel")
  })

  it("a video plays in the side panel's player", () => {
    for (const desktop of [true, false]) expect(route({ url: "/attachments/v1", kind: "video" }, { desktop })).toBe("panel")
  })

  it("a text file (a transcript, a log, markdown) shows in the side panel's text view, never the built-in browser", () => {
    for (const desktop of [true, false]) {
      expect(route({ url: "/attachments/f1", kind: "text", name: "transcript.txt" }, { desktop })).toBe("panel")
      expect(route({ url: "/attachments/f1" }, { desktop })).toBe("panel")
    }
  })

  it("a Cello page shows in the side panel, never the built-in browser", () => {
    for (const desktop of [true, false]) {
      expect(route({ url: "/CEL/pages/notes" }, { desktop })).toBe("panel")
      expect(route({ url: "http://localhost:4747/CEL/pages/notes#next-steps" }, { desktop })).toBe("panel")
    }
  })

  it("another site goes to the desktop app's built-in browser, or the side panel's iframe attempt in a browser", () => {
    expect(route({ url: "https://claude.ai/artifact/abc" }, { desktop: true })).toBe("desktop")
    expect(route({ url: "http://localhost:5173/" }, { desktop: true })).toBe("desktop")
    expect(route({ url: "https://claude.ai/artifact/abc" }, { desktop: false })).toBe("panel")
  })

  it("from a Cello page framed in the side panel, whatever it is goes to the board's window, which decides", () => {
    expect(route({ url: "/x/board.png" }, { framed: true })).toBe("parent")
    expect(route({ url: "/CEL/pages/notes" }, { framed: true })).toBe("parent")
  })
})

describe("openTarget: carries out the route", () => {
  const bridge = () => ({ isDesktop: true as const, openPanel: vi.fn<CelloDesktop["openPanel"]>(), closePanel: vi.fn() })
  const env = (extra: Partial<OpenEnv> = {}): OpenEnv => ({ origin: ORIGIN, desktop: undefined, show: vi.fn(), modal: vi.fn(), ...extra })

  it("an outside site in the desktop app: the native browser panel, with an absolute URL", () => {
    const desktop = bridge()
    const e = env({ desktop })
    expect(openTarget({ url: "https://claude.ai/artifact/abc", title: "Artifact" }, e)).toBe("desktop")
    expect(desktop.openPanel).toHaveBeenCalledWith("https://claude.ai/artifact/abc", "Artifact")
    expect(e.show).not.toHaveBeenCalled()
  })

  it("a Cello page in the desktop app: the in-app side panel, not the native one", () => {
    const desktop = bridge()
    const e = env({ desktop })
    expect(openTarget({ url: "/CEL/pages/notes", title: "Notes" }, e)).toBe("panel")
    expect(e.show).toHaveBeenCalledWith({ url: "http://localhost:4747/CEL/pages/notes", title: "Notes", kind: "page" })
    expect(desktop.openPanel).not.toHaveBeenCalled()
  })

  it("a text file in the desktop app: the in-app side panel too", () => {
    const desktop = bridge()
    const e = env({ desktop })
    expect(openTarget({ url: "/attachments/f1", kind: "text", name: "run.log" }, e)).toBe("panel")
    expect(e.show).toHaveBeenCalledWith({ url: "http://localhost:4747/attachments/f1", title: "run.log", kind: "text", name: "run.log" })
    expect(desktop.openPanel).not.toHaveBeenCalled()
  })

  it("an image link: the image modal", () => {
    const e = env()
    expect(openTarget({ url: "/x/board.png", title: "Board" }, e)).toBe("modal")
    expect(e.modal).toHaveBeenCalledWith({ url: "http://localhost:4747/x/board.png", title: "Board", kind: "image" })
    expect(e.show).not.toHaveBeenCalled()
  })

  it("in a browser, an outside site goes to the side panel", () => {
    const e = env()
    expect(openTarget({ url: "https://claude.ai/artifact/abc" }, e)).toBe("panel")
    expect(e.show).toHaveBeenCalledWith({ url: "https://claude.ai/artifact/abc", title: "claude.ai/artifact/abc", kind: "external" })
  })

  it("from a Cello page framed in the side panel, the board's window gets the target, with an absolute URL", () => {
    const parent = vi.fn()
    const e = env({ parent })
    expect(openTarget({ url: "/attachments/a1", kind: "image", place: "viewer" }, e)).toBe("parent")
    expect(parent).toHaveBeenCalledWith({ url: "http://localhost:4747/attachments/a1", kind: "image", place: "viewer" })
    expect(e.show).not.toHaveBeenCalled()
  })

  it("nowhere for something that isn't a web page, so the link does what it would anyway", () => {
    const desktop = bridge()
    const e = env({ desktop })
    expect(openTarget({ url: "mailto:me@x.dev" }, e)).toBeNull()
    expect(openTarget({ url: "javascript:alert(1)" }, env())).toBeNull()
    expect(desktop.openPanel).not.toHaveBeenCalled()
    expect(e.show).not.toHaveBeenCalled()
  })
})

describe("pageRef: which document a Cello page URL shows, for the side panel's reader", () => {
  it("a page's project, slug, pinned version and section", () => {
    expect(pageRef("http://localhost:4747/CEL/pages/billing-audit", ORIGIN)).toEqual({ projectKey: "CEL", slug: "billing-audit", version: undefined, hash: "" })
    expect(pageRef("http://localhost:4747/CEL/pages/billing-audit?version=2&embed=1#next-steps", ORIGIN)).toEqual({
      projectKey: "CEL",
      slug: "billing-audit",
      version: 2,
      hash: "next-steps",
    })
    expect(pageRef("http://localhost:4747/CEL/pages/r%C3%A9sum%C3%A9/", ORIGIN)?.slug).toBe("résumé")
  })

  it("null for other routes, other sites, and a version that isn't one", () => {
    expect(pageRef("http://localhost:4747/CEL/docs", ORIGIN)).toBeNull()
    expect(pageRef("http://localhost:4747/review", ORIGIN)).toBeNull()
    expect(pageRef("http://localhost:4747/CEL/pages/a/b", ORIGIN)).toBeNull()
    expect(pageRef("https://example.com/CEL/pages/notes", ORIGIN)).toBeNull()
    expect(pageRef("http://localhost:4747/CEL/pages/notes?version=0", ORIGIN)?.version).toBeUndefined()
  })
})

describe("fullPageHref: where Expand to full page goes", () => {
  it("the board's own address, without ?embed, keeping the version and the section", () => {
    expect(fullPageHref("http://localhost:4747/CEL/pages/notes?embed=1&version=2#next")).toBe("/CEL/pages/notes?version=2#next")
    expect(fullPageHref("http://localhost:4747/review")).toBe("/review")
  })
})

describe("withVersion: the side panel's reader picks another version", () => {
  it("sets or drops ?version, keeping the rest", () => {
    expect(withVersion("http://localhost:4747/CEL/pages/notes#a", 3)).toBe("http://localhost:4747/CEL/pages/notes?version=3#a")
    expect(withVersion("http://localhost:4747/CEL/pages/notes?version=3", undefined)).toBe("http://localhost:4747/CEL/pages/notes")
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

describe("taskRoute: a task key always opens its task in the main window", () => {
  const top = {}
  it("on the board, through its router", () => {
    expect(taskRoute({ self: top, top, search: "?layout=list" })).toBe("router")
  })
  it("from a Cello page framed in the viewer, through the board's window", () => {
    expect(taskRoute({ self: {}, top, search: "?embed=1" })).toBe("parent")
  })
  it("from a Cello page alone in a panel (the desktop app's), by following the link, which the app catches", () => {
    expect(taskRoute({ self: top, top, search: "?embed=1" })).toBe("link")
  })
})

describe("openTaskFrom: what the board's window accepts from a page asking it to open a task", () => {
  it("a task key from a page on the board's own origin", () => {
    expect(openTaskFrom({ origin: ORIGIN, data: { type: "cello:task", key: "CEL-12" } }, ORIGIN)).toEqual({ projectKey: "CEL", number: 12 })
  })
  it("nothing from another origin, another kind of message, or a malformed key", () => {
    expect(openTaskFrom({ origin: "https://evil.dev", data: { type: "cello:task", key: "CEL-12" } }, ORIGIN)).toBeNull()
    expect(openTaskFrom({ origin: ORIGIN, data: { type: "cello:open", key: "CEL-12" } }, ORIGIN)).toBeNull()
    for (const key of ["CEL", "../../settings", 12, null]) expect(openTaskFrom({ origin: ORIGIN, data: { type: "cello:task", key } }, ORIGIN)).toBeNull()
    expect(openTaskFrom({ origin: ORIGIN, data: null }, ORIGIN)).toBeNull()
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

describe("the viewer's width (the rules are lib/resize.ts's)", () => {
  it("starts as wide as the task panel, so the board keeps its width when one replaces the other", () => {
    expect(readWidth(null, VIEWER_WIDTH)).toBe(560)
  })

  it("stays between 320px and what leaves 360px for the page beside it", () => {
    expect(clampWidth(100, VIEWER_WIDTH, 1200)).toBe(320)
    expect(clampWidth(1100, VIEWER_WIDTH, 1200)).toBe(1200 - 360)
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
