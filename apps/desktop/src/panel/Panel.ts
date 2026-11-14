// The browser panel: two WebContentsViews on the right of the main window. The chrome view (left
// edge + toolbar) covers the panel area; the page view sits on it below the toolbar and loads pages
// top-level, so sites that refuse to be framed (claude.ai: `frame-ancestors 'self'`) still show.
import { shell, WebContentsView, type BrowserWindowConstructorOptions, type WebContents } from "electron"
import {
  CHROME_COMMAND,
  CHROME_RESIZE,
  FOCUS_ADDRESS,
  PANEL_STATE,
  type ChromeCommand,
  type PanelState,
  type ResizeMessage,
} from "../ipc.ts"
import { addressToUrl, panelNavigationAction, panelTitle, panelUrl, panelWindowOpenAction } from "./urls.ts"

/** Panel pages keep their cookies across launches, apart from the board's session. */
export const PANEL_PARTITION = "persist:panel"

export interface PanelHost {
  /** Re-runs the window layout after the panel opens, closes or changes width. */
  readonly relayout: () => void
  readonly panelWidth: () => number
  /** `persist`: the drag ended, so save the width. */
  readonly setPanelWidth: (width: number, persist: boolean) => void
  readonly focusBoard: () => void
}

export interface PanelFiles {
  readonly chromePreload: string
  readonly chromeHtml: string
}

const POPUP_OPTIONS: BrowserWindowConstructorOptions = {
  width: 520,
  height: 700,
  webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
}

const isCommand = (value: unknown): value is ChromeCommand => {
  if (typeof value !== "object" || value === null) return false
  const { kind, address } = value as { kind?: unknown; address?: unknown }
  if (kind === "navigate") return typeof address === "string"
  return typeof kind === "string" && ["back", "forward", "reload", "stop", "external", "close"].includes(kind)
}

const isResize = (value: unknown): value is ResizeMessage =>
  typeof value === "object" && value !== null &&
  ["start", "move", "end"].includes((value as ResizeMessage).phase) && Number.isFinite((value as ResizeMessage).screenX)

export class Panel {
  readonly chrome: WebContentsView
  readonly page: WebContentsView
  #open = false
  /** The URL and title the panel was last asked to show, so the toolbar keeps Cello's title for it. */
  #opened: { url: string; title: string } | null = null
  #failure: { url: string; description: string } | null = null
  #drag: { startX: number; startWidth: number } | null = null

  constructor(private readonly host: PanelHost, files: PanelFiles, background: string) {
    this.chrome = new WebContentsView({
      webPreferences: { preload: files.chromePreload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    this.page = new WebContentsView({
      webPreferences: { partition: PANEL_PARTITION, contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    // Only the toolbar takes the board's color: a page without a background of its own is white, as in a browser.
    this.chrome.setBackgroundColor(background)
    this.chrome.setVisible(false)
    this.page.setVisible(false)

    const chrome = this.chrome.webContents
    chrome.ipc.on(CHROME_COMMAND, (_event, command: unknown) => {
      if (isCommand(command)) this.#run(command)
    })
    chrome.ipc.on(CHROME_RESIZE, (_event, message: unknown) => {
      if (isResize(message)) this.#resize(message)
    })
    chrome.on("did-finish-load", () => this.#sendState())
    chrome.setWindowOpenHandler(() => ({ action: "deny" }))
    chrome.on("will-navigate", (event) => event.preventDefault())
    void chrome.loadFile(files.chromeHtml)

    this.#wirePage(this.page.webContents)
    // A blank document from the start, so the page view exists as a page (and for tests) before any URL.
    void this.page.webContents.loadURL("about:blank")
  }

  get isOpen(): boolean {
    return this.#open
  }

  /** The page's URL, or "" before any page. */
  get url(): string {
    const url = this.page.webContents.getURL()
    return url === "about:blank" ? "" : url
  }

  /** Opens an http(s) page in the panel; anything else is refused (returns false). */
  open(raw: string, title?: string): boolean {
    const url = panelUrl(raw)
    if (!url) return false
    this.#opened = { url, title: title?.trim() ?? "" }
    if (this.page.webContents.getURL() !== url) this.#load(url)
    this.#reveal()
    this.page.webContents.focus()
    return true
  }

  /** Shows the panel with whatever it last showed; with nothing yet, the address field gets the cursor. */
  show(): void {
    this.#reveal()
    if (this.url === "") this.focusAddress()
  }

  #reveal(): void {
    if (!this.#open) {
      this.#open = true
      this.chrome.setVisible(true)
      this.page.setVisible(true)
      this.page.webContents.setAudioMuted(false)
      this.host.relayout()
    }
    this.#sendState()
  }

  /** Hides the panel; the page stays loaded (muted) so ⌘\ brings it back as it was. */
  close(): void {
    if (!this.#open) return
    this.#open = false
    this.chrome.setVisible(false)
    this.page.setVisible(false)
    this.page.webContents.setAudioMuted(true)
    this.host.relayout()
    this.host.focusBoard()
    this.#sendState()
  }

  toggle(): void {
    if (this.#open) this.close()
    else {
      this.show()
      if (this.url !== "") this.page.webContents.focus()
    }
  }

  focusAddress(): void {
    this.chrome.webContents.focus()
    this.chrome.webContents.send(FOCUS_ADDRESS)
  }

  #load(url: string): void {
    this.#failure = null
    // Navigation errors arrive as did-fail-load; the promise's rejection repeats them.
    this.page.webContents.loadURL(url).catch(() => {})
  }

  #wirePage(page: WebContents): void {
    // The blank document the view starts on isn't a page to go back to.
    page.on("did-navigate", () => {
      const history = page.navigationHistory
      if (history.length() > 1 && history.getEntryAtIndex(0)?.url === "about:blank") history.removeEntryAtIndex(0)
    })
    for (const event of ["did-start-loading", "did-stop-loading", "did-navigate", "did-navigate-in-page", "page-title-updated"] as const) {
      page.on(event as "did-start-loading", () => this.#sendState())
    }
    page.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument) this.#failure = null
    })
    page.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
      // -3 is ERR_ABORTED: a newer navigation replaced this one.
      if (!isMainFrame || code === -3) return
      this.#failure = { url, description }
      this.#sendState()
    })
    page.setWindowOpenHandler((details) => {
      const action = panelWindowOpenAction(details)
      if (action === "popup") return { action: "allow", overrideBrowserWindowOptions: POPUP_OPTIONS }
      if (action === "panel") this.#load(details.url)
      if (action === "external") void shell.openExternal(details.url)
      return { action: "deny" }
    })
    // A sign-in popup may not open popups of its own.
    page.on("did-create-window", (popup) => popup.webContents.setWindowOpenHandler(() => ({ action: "deny" })))
    page.on("will-navigate", (event, url) => {
      const action = panelNavigationAction(url)
      if (action === "allow") return
      event.preventDefault()
      if (action === "external") void shell.openExternal(url)
    })
    page.on("before-input-event", (event, input) => {
      // ⌘L puts the cursor in the address field, as in a browser.
      if (input.type === "keyDown" && input.meta && !input.shift && !input.alt && input.key.toLowerCase() === "l") {
        event.preventDefault()
        this.focusAddress()
      }
    })
  }

  #run(command: ChromeCommand): void {
    const page = this.page.webContents
    switch (command.kind) {
      case "back":
        if (page.navigationHistory.canGoBack()) page.navigationHistory.goBack()
        return
      case "forward":
        if (page.navigationHistory.canGoForward()) page.navigationHistory.goForward()
        return
      case "reload":
        if (this.#failure) this.#load(this.#failure.url)
        else page.reload()
        return
      case "stop":
        page.stop()
        return
      case "external": {
        const url = panelUrl(this.#failure?.url ?? page.getURL())
        if (url) void shell.openExternal(url)
        return
      }
      case "close":
        this.close()
        return
      case "navigate": {
        const url = addressToUrl(command.address)
        if (url) this.open(url)
        else this.#sendState()
      }
    }
  }

  /**
   * The edge follows the pointer: the panel grows by however far the pointer moved left since the
   * drag began. The end only saves the width; its position was already sent as the last move.
   */
  #resize(message: ResizeMessage): void {
    if (message.phase === "start") {
      this.#drag = { startX: message.screenX, startWidth: this.host.panelWidth() }
    } else if (this.#drag && message.phase === "move") {
      this.host.setPanelWidth(this.#drag.startWidth + (this.#drag.startX - message.screenX), false)
    } else if (this.#drag) {
      this.#drag = null
      this.host.setPanelWidth(this.host.panelWidth(), true)
    }
  }

  #sendState(): void {
    if (this.chrome.webContents.isDestroyed() || this.page.webContents.isDestroyed()) return
    const page = this.page.webContents
    const failure = this.#failure
    const url = failure?.url ?? this.url
    const state: PanelState = {
      open: this.#open,
      url,
      title: failure
        ? `Couldn't load ${URL.parse(failure.url)?.host ?? failure.url} (${failure.description})`
        : panelTitle({ url, pageTitle: url === "" ? "" : page.getTitle(), opened: this.#opened }),
      canGoBack: page.navigationHistory.canGoBack(),
      canGoForward: page.navigationHistory.canGoForward(),
      loading: page.isLoading(),
    }
    this.chrome.webContents.send(PANEL_STATE, state)
  }

  /** Closes both views' web contents; BaseWindow doesn't do it for its child views. */
  destroy(): void {
    for (const view of [this.chrome, this.page]) if (!view.webContents.isDestroyed()) view.webContents.close()
  }
}
