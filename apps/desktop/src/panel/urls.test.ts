import { describe, expect, it } from "vitest"
import {
  addressToUrl,
  boardNavigationAction,
  boardTaskKey,
  boardWindowOpenAction,
  panelNavigationAction,
  panelPageUrl,
  panelTitle,
  panelUrl,
  panelWindowOpenAction,
} from "./urls.ts"

const BOARD = "http://127.0.0.1:4747"

describe("boardTaskKey: a link in the panel to a task on the board opens it in the main window", () => {
  it("the task a board URL shows", () => {
    expect(boardTaskKey("http://127.0.0.1:4747/CEL/3", BOARD)).toBe("CEL-3")
    expect(boardTaskKey("http://127.0.0.1:4747/thai/12?layout=list", BOARD)).toBe("THAI-12")
  })

  it("nothing for other board pages, other sites, or before the board is up", () => {
    for (const url of ["http://127.0.0.1:4747/CEL/pages/notes", "http://127.0.0.1:4747/CEL/issues", "http://127.0.0.1:4747/review"]) {
      expect(boardTaskKey(url, BOARD)).toBeNull()
    }
    expect(boardTaskKey("http://127.0.0.1:5173/CEL/3", BOARD)).toBeNull()
    expect(boardTaskKey("https://github.com/CEL/3", BOARD)).toBeNull()
    expect(boardTaskKey("http://127.0.0.1:4747/CEL/3", null)).toBeNull()
    expect(boardTaskKey("not a url", BOARD)).toBeNull()
  })
})

describe("panelPageUrl: Cello pages in the panel show without the sidebar, however they were opened", () => {
  it("adds embed=1 to the board's pages (cello://open, the address field, the board)", () => {
    expect(panelPageUrl("http://127.0.0.1:4747/CEL/pages/notes", BOARD)).toBe("http://127.0.0.1:4747/CEL/pages/notes?embed=1")
  })

  it("leaves other sites alone, and everything before the board is up", () => {
    expect(panelPageUrl("https://claude.ai/artifact/x", BOARD)).toBe("https://claude.ai/artifact/x")
    expect(panelPageUrl("http://127.0.0.1:4747/CEL/pages/notes", null)).toBe("http://127.0.0.1:4747/CEL/pages/notes")
  })
})

describe("panelUrl", () => {
  it("allows http and https pages, including claude.ai artifacts and local dev servers", () => {
    expect(panelUrl("https://claude.ai/artifact/RNpQF3GNVbCdMLNVWJqoYh")).toBe("https://claude.ai/artifact/RNpQF3GNVbCdMLNVWJqoYh")
    expect(panelUrl("http://localhost:5173")).toBe("http://localhost:5173/")
    expect(panelUrl("  http://127.0.0.1:4791/x?y=1  ")).toBe("http://127.0.0.1:4791/x?y=1")
  })

  it("refuses every other scheme and anything that isn't a URL", () => {
    for (const bad of ["javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi", "cello://CEL-3", "about:blank", "ftp://x.org", "", "not a url"]) {
      expect(panelUrl(bad), bad).toBeNull()
    }
  })
})

describe("addressToUrl", () => {
  it("takes what was typed in the address field and makes a URL", () => {
    expect(addressToUrl("localhost:5173")).toBe("http://localhost:5173/")
    expect(addressToUrl("127.0.0.1:4791/CEL/3")).toBe("http://127.0.0.1:4791/CEL/3")
    expect(addressToUrl("claude.ai/artifact/abc")).toBe("https://claude.ai/artifact/abc")
    expect(addressToUrl("https://example.com")).toBe("https://example.com/")
  })

  it("refuses words, other schemes and blanks", () => {
    expect(addressToUrl("hello world")).toBeNull()
    expect(addressToUrl("javascript:alert(1)")).toBeNull()
    expect(addressToUrl("   ")).toBeNull()
  })
})

describe("new windows and navigation", () => {
  it("sends the board's new-window links to the panel, mail to the mail app, and refuses the rest", () => {
    expect(boardWindowOpenAction("https://claude.ai/artifact/x")).toBe("panel")
    expect(boardWindowOpenAction("mailto:me@example.com")).toBe("external")
    expect(boardWindowOpenAction("file:///etc/passwd")).toBe("deny")
  })

  it("keeps the board on its own origin; other pages go to the panel", () => {
    const board = "http://127.0.0.1:4747"
    expect(boardNavigationAction("http://127.0.0.1:4747/CEL/3", board)).toBe("allow")
    expect(boardNavigationAction("https://github.com/x/y", board)).toBe("panel")
    expect(boardNavigationAction("http://127.0.0.1:5173/", board)).toBe("panel")
    expect(boardNavigationAction("javascript:alert(1)", board)).toBe("deny")
  })

  it("keeps links that open new windows inside the panel, but lets sign-in popups open", () => {
    expect(panelWindowOpenAction({ url: "https://example.com/a", disposition: "foreground-tab" })).toBe("panel")
    expect(panelWindowOpenAction({ url: "https://example.com/a", disposition: "background-tab" })).toBe("panel")
    expect(panelWindowOpenAction({ url: "https://accounts.google.com/o/oauth2", disposition: "new-window" })).toBe("popup")
    expect(panelWindowOpenAction({ url: "mailto:me@example.com", disposition: "foreground-tab" })).toBe("external")
    expect(panelWindowOpenAction({ url: "file:///etc/passwd", disposition: "new-window" })).toBe("deny")
  })

  it("lets the panel go to web pages only", () => {
    expect(panelNavigationAction("https://claude.ai/login")).toBe("allow")
    expect(panelNavigationAction("about:blank")).toBe("allow")
    expect(panelNavigationAction("mailto:me@example.com")).toBe("external")
    expect(panelNavigationAction("file:///etc/passwd")).toBe("deny")
  })
})

describe("panelTitle", () => {
  const opened = { url: "https://claude.ai/artifact/x", title: "Review packet" }

  it("shows the title Cello gave while the panel is still on that page", () => {
    expect(panelTitle({ url: "https://claude.ai/artifact/x", pageTitle: "Claude", opened })).toBe("Review packet")
  })

  it("shows the page's own title after navigating away, else the URL", () => {
    expect(panelTitle({ url: "https://claude.ai/login", pageTitle: "Sign in", opened })).toBe("Sign in")
    expect(panelTitle({ url: "https://claude.ai/login", pageTitle: "", opened })).toBe("https://claude.ai/login")
    expect(panelTitle({ url: "", pageTitle: "", opened: null })).toBe("")
  })
})
