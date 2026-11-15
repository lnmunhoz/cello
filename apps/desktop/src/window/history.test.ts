import { describe, expect, it } from "vitest"
import { appCommandDirection, goInHistory, historyShortcut, mouseButtonDirection, swipeDirection } from "./history.ts"

describe("historyShortcut", () => {
  const key = (over: Partial<Parameters<typeof historyShortcut>[0]>) =>
    ({ type: "keyDown", key: "[", code: "BracketLeft", meta: false, control: false, alt: false, shift: false, ...over }) as const

  it("is ⌘[ back and ⌘] forward on macOS, as in Safari and Chrome", () => {
    expect(historyShortcut(key({ meta: true }), "darwin")).toBe("back")
    expect(historyShortcut(key({ meta: true, key: "]", code: "BracketRight" }), "darwin")).toBe("forward")
    // Another layout: matched by the key's position.
    expect(historyShortcut(key({ meta: true, key: "ü" }), "darwin")).toBe("back")
  })

  it("is Ctrl elsewhere", () => {
    expect(historyShortcut(key({ control: true }), "linux")).toBe("back")
    expect(historyShortcut(key({ control: true, key: "]", code: "BracketRight" }), "win32")).toBe("forward")
    expect(historyShortcut(key({ meta: true }), "linux")).toBeNull()
  })

  it("is nothing without the modifier, with another one, on key up, or for another key", () => {
    expect(historyShortcut(key({}), "darwin")).toBeNull()
    expect(historyShortcut(key({ meta: true, shift: true }), "darwin")).toBeNull()
    expect(historyShortcut(key({ meta: true, alt: true }), "darwin")).toBeNull()
    expect(historyShortcut(key({ meta: true, type: "keyUp" }), "darwin")).toBeNull()
    expect(historyShortcut(key({ meta: true, key: "\\", code: "Backslash" }), "darwin")).toBeNull()
  })
})

describe("the other ways back and forward", () => {
  it("mouse back and forward buttons arrive as app commands on Windows and Linux", () => {
    expect(appCommandDirection("browser-backward")).toBe("back")
    expect(appCommandDirection("browser-forward")).toBe("forward")
    expect(appCommandDirection("media-play")).toBeNull()
  })

  it("and as DOM mouse buttons 3 and 4 on macOS", () => {
    expect(mouseButtonDirection(3)).toBe("back")
    expect(mouseButtonDirection(4)).toBe("forward")
    expect(mouseButtonDirection(0)).toBeNull()
    expect(mouseButtonDirection(2)).toBeNull()
  })

  it("a trackpad swipe: left goes back, right goes forward", () => {
    expect(swipeDirection("left")).toBe("back")
    expect(swipeDirection("right")).toBe("forward")
    expect(swipeDirection("up")).toBeNull()
  })
})

describe("goInHistory", () => {
  const history = (canGoBack: boolean, canGoForward: boolean) => {
    const calls: string[] = []
    return {
      calls,
      canGoBack: () => canGoBack,
      canGoForward: () => canGoForward,
      goBack: () => calls.push("back"),
      goForward: () => calls.push("forward"),
    }
  }

  it("goes when there's somewhere to go, and does nothing otherwise", () => {
    const both = history(true, true)
    goInHistory(both, "back")
    goInHistory(both, "forward")
    expect(both.calls).toEqual(["back", "forward"])
    const none = history(false, false)
    goInHistory(none, "back")
    goInHistory(none, "forward")
    expect(none.calls).toEqual([])
  })
})
