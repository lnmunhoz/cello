import { describe, expect, it } from "vitest"
import {
  addressToUrl,
  boardNavigationAction,
  boardTaskKey,
  boardWindowOpenAction,
  panelNavigation,
  panelNavigationAction,
  panelPageUrl,
  panelTitle,
  panelUrl,
  panelWindowOpen,
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

describe("panelNavigation: where a panel page's navigation goes", () => {
  const onBoard = { boardOrigin: BOARD, from: "http://127.0.0.1:4747/CEL/pages/notes?embed=1" }
  const onSite = { boardOrigin: BOARD, from: "https://evil.example/" }

  it("a Cello page following a link to a task: the task opens in the main window", () => {
    expect(panelNavigation("http://127.0.0.1:4747/CEL/3", onBoard)).toEqual({ kind: "task", key: "CEL-3" })
  })

  it("another site can't open tasks on the board: its link loads in the panel, as a Cello page without the sidebar", () => {
    expect(panelNavigation("http://127.0.0.1:4747/CEL/3", onSite)).toEqual({ kind: "load", url: "http://127.0.0.1:4747/CEL/3?embed=1" })
  })

  it("a link to another Cello page keeps it without the sidebar", () => {
    expect(panelNavigation("http://127.0.0.1:4747/CEL/pages/other", onBoard)).toEqual({ kind: "load", url: "http://127.0.0.1:4747/CEL/pages/other?embed=1" })
    expect(panelNavigation("http://127.0.0.1:4747/CEL/pages/other?embed=1", onBoard)).toEqual({ kind: "allow" })
    expect(panelNavigation("http://127.0.0.1:4747/attachments/a1", onBoard)).toEqual({ kind: "allow" })
  })

  it("other sites as before: web pages load, mail goes to the mail app, the rest is refused", () => {
    expect(panelNavigation("https://claude.ai/login", onSite)).toEqual({ kind: "allow" })
    expect(panelNavigation("mailto:me@example.com", onBoard)).toEqual({ kind: "external" })
    expect(panelNavigation("file:///etc/passwd", onBoard)).toEqual({ kind: "deny" })
    expect(panelNavigation("http://127.0.0.1:4747/CEL/3", { boardOrigin: null, from: "" })).toEqual({ kind: "allow" })
  })
})

describe("panelWindowOpen: a panel page that wants a new window", () => {
  const onBoard = { boardOrigin: BOARD, from: "http://127.0.0.1:4747/CEL/pages/notes?embed=1" }
  const onSite = { boardOrigin: BOARD, from: "https://evil.example/" }

  it("a task link from a Cello page opens the task in the main window", () => {
    expect(panelWindowOpen({ url: "http://127.0.0.1:4747/CEL/3", disposition: "foreground-tab" }, onBoard)).toEqual({ kind: "task", key: "CEL-3" })
  })

  it("from another site, a board link loads in the panel without the sidebar, never on the board", () => {
    expect(panelWindowOpen({ url: "http://127.0.0.1:4747/CEL/3", disposition: "foreground-tab" }, onSite)).toEqual({ kind: "load", url: "http://127.0.0.1:4747/CEL/3?embed=1" })
    expect(panelWindowOpen({ url: "http://127.0.0.1:4747/CEL/3", disposition: "new-window" }, onSite)).toEqual({ kind: "load", url: "http://127.0.0.1:4747/CEL/3?embed=1" })
  })

  it("Cello pages it opens show without the sidebar; other pages stay in the panel; sign-in popups open", () => {
    expect(panelWindowOpen({ url: "http://127.0.0.1:4747/CEL/pages/other", disposition: "foreground-tab" }, onBoard)).toEqual({ kind: "load", url: "http://127.0.0.1:4747/CEL/pages/other?embed=1" })
    expect(panelWindowOpen({ url: "https://example.com/a", disposition: "foreground-tab" }, onSite)).toEqual({ kind: "load", url: "https://example.com/a" })
    expect(panelWindowOpen({ url: "https://accounts.google.com/o/oauth2", disposition: "new-window" }, onSite)).toEqual({ kind: "popup" })
    expect(panelWindowOpen({ url: "mailto:me@example.com", disposition: "foreground-tab" }, onSite)).toEqual({ kind: "external" })
    expect(panelWindowOpen({ url: "file:///etc/passwd", disposition: "new-window" }, onSite)).toEqual({ kind: "deny" })
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
