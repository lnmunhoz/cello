import { afterEach, describe, expect, it, vi } from "vitest"
import { closeImageModal, imageModal } from "../viewer/imageModal.ts"
import { closeViewer, viewerItem } from "../viewer/store.ts"
import { openInPanel, openTask } from "./desktop.ts"

const ORIGIN = "http://localhost:4747"
/** A top-level page on the board's origin, plus whatever the test adds. */
const stubWindow = (extra: object = {}) => {
  const win: Record<string, unknown> = { location: { origin: ORIGIN, search: "" }, open: vi.fn(), ...extra }
  win.self = win
  win.top = win
  vi.stubGlobal("window", win)
  return win
}

describe("openInPanel", () => {
  afterEach(() => {
    closeViewer()
    closeImageModal()
    vi.unstubAllGlobals()
  })

  it("opens an outside site in the desktop app's native browser when the board runs there", () => {
    const openPanel = vi.fn()
    stubWindow({ celloDesktop: { isDesktop: true, openPanel, closePanel: vi.fn() } })
    expect(openInPanel({ url: "https://claude.ai/artifact/x", title: "Review packet" })).toBe(true)
    expect(openPanel).toHaveBeenCalledWith("https://claude.ai/artifact/x", "Review packet")
    expect(viewerItem()).toBeNull()
  })

  it("opens a Cello page in the in-app side panel, in the desktop app too (CEL-60)", () => {
    const openPanel = vi.fn()
    stubWindow({ celloDesktop: { isDesktop: true, openPanel, closePanel: vi.fn() } })
    expect(openInPanel({ url: "/CEL/pages/notes", title: "Notes" })).toBe(true)
    expect(viewerItem()).toEqual({ url: "http://localhost:4747/CEL/pages/notes", title: "Notes", kind: "page" })
    expect(openPanel).not.toHaveBeenCalled()
  })

  it("opens Open in viewer's image in the side panel, never a new tab", () => {
    const win = stubWindow()
    expect(openInPanel({ url: "/attachments/a1", title: "The board", kind: "image", place: "viewer" })).toBe(true)
    expect(viewerItem()).toEqual({ url: "http://localhost:4747/attachments/a1", title: "The board", kind: "image" })
    expect(win.open).not.toHaveBeenCalled()
  })

  it("opens an image link in the image modal", () => {
    stubWindow()
    expect(openInPanel({ url: "/x/board.png", title: "The board" })).toBe(true)
    expect(imageModal()?.items).toEqual([{ url: "http://localhost:4747/x/board.png", title: "The board" }])
    expect(viewerItem()).toBeNull()
  })

  it("from a Cello page framed in the viewer, asks the board's window to open it", () => {
    const postMessage = vi.fn()
    const win: Record<string, unknown> = { location: { origin: ORIGIN, search: "?embed=1" }, parent: { postMessage } }
    win.self = win
    win.top = win.parent
    vi.stubGlobal("window", win)
    expect(openInPanel({ url: "https://example.com/" })).toBe(true)
    expect(postMessage).toHaveBeenCalledWith({ type: "cello:open", item: { url: "https://example.com/" } }, ORIGIN)
    expect(viewerItem()).toBeNull()
  })

  it("leaves a link it can't show alone", () => {
    stubWindow()
    expect(openInPanel({ url: "mailto:me@x.dev" })).toBe(false)
    expect(viewerItem()).toBeNull()
  })
})


describe("openTask", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("on the board, opens the task with the router", () => {
    stubWindow()
    const navigate = vi.fn()
    expect(openTask("CEL-12", navigate)).toBe(true)
    expect(navigate).toHaveBeenCalledWith({ projectKey: "CEL", number: 12 })
  })

  it("from a Cello page framed in the viewer, asks the board's window to open it", () => {
    const postMessage = vi.fn()
    const win: Record<string, unknown> = { location: { origin: ORIGIN, search: "?embed=1" }, parent: { postMessage } }
    win.self = win
    win.top = win.parent
    vi.stubGlobal("window", win)
    const navigate = vi.fn()
    expect(openTask("CEL-12", navigate)).toBe(true)
    expect(postMessage).toHaveBeenCalledWith({ type: "cello:task", key: "CEL-12" }, ORIGIN)
    expect(navigate).not.toHaveBeenCalled()
  })

  it("from a page alone in a panel (the desktop app's), lets the link navigate so the app can catch it", () => {
    stubWindow({ location: { origin: ORIGIN, search: "?embed=1" } })
    const navigate = vi.fn()
    expect(openTask("CEL-12", navigate)).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })
})
