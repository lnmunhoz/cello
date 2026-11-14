import { afterEach, describe, expect, it, vi } from "vitest"
import { closeViewer, viewerItem } from "../viewer/store.ts"
import { openInPanel } from "./desktop.ts"

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
    vi.unstubAllGlobals()
  })

  it("opens the page in the desktop app's side panel when the board runs there", () => {
    const openPanel = vi.fn()
    stubWindow({ celloDesktop: { isDesktop: true, openPanel, closePanel: vi.fn() } })
    expect(openInPanel("https://claude.ai/artifact/x", "Review packet")).toBe(true)
    expect(openPanel).toHaveBeenCalledWith("https://claude.ai/artifact/x", "Review packet")
    expect(viewerItem()).toBeNull()
  })

  it("opens it in the web viewer panel otherwise, never a new tab", () => {
    const win = stubWindow()
    expect(openInPanel("/attachments/a1", "The board", "image")).toBe(true)
    expect(viewerItem()).toEqual({ url: "http://localhost:4747/attachments/a1", title: "The board", kind: "image" })
    expect(win.open).not.toHaveBeenCalled()
  })

  it("from a Cello page framed in the viewer, asks the board's window to open it", () => {
    const postMessage = vi.fn()
    const win: Record<string, unknown> = { location: { origin: ORIGIN, search: "?embed=1" }, parent: { postMessage } }
    win.self = win
    win.top = win.parent
    vi.stubGlobal("window", win)
    expect(openInPanel("https://example.com/")).toBe(true)
    expect(postMessage).toHaveBeenCalledWith(
      { type: "cello:open", item: { url: "https://example.com/", title: "example.com", kind: "external" } },
      ORIGIN,
    )
    expect(viewerItem()).toBeNull()
  })

  it("leaves a link it can't show alone", () => {
    stubWindow()
    expect(openInPanel("mailto:me@x.dev")).toBe(false)
    expect(viewerItem()).toBeNull()
  })
})
