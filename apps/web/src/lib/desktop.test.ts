import { afterEach, describe, expect, it, vi } from "vitest"
import { openInPanel } from "./desktop.ts"

describe("openInPanel", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("opens the page in the desktop app's side panel when the board runs there", () => {
    const openPanel = vi.fn()
    const open = vi.fn()
    vi.stubGlobal("window", { celloDesktop: { isDesktop: true, openPanel, closePanel: vi.fn() }, open })
    openInPanel("https://claude.ai/artifact/x", "Review packet")
    expect(openPanel).toHaveBeenCalledWith("https://claude.ai/artifact/x", "Review packet")
    expect(open).not.toHaveBeenCalled()
  })

  it("opens a new browser tab otherwise", () => {
    const open = vi.fn()
    vi.stubGlobal("window", { open })
    openInPanel("https://claude.ai/artifact/x")
    expect(open).toHaveBeenCalledWith("https://claude.ai/artifact/x", "_blank", "noopener,noreferrer")
  })
})
