// The main window: the board (a WebContentsView loading the server's web app) with the browser
// panel docked on its right. Remembers its size, position and the panel's width in
// window-state.json; the panel's URL lives only as long as the app runs.
import * as fs from "node:fs"
import { BaseWindow, nativeTheme, screen, shell, webContents, WebContentsView, type WebContents } from "electron"
import type { DesktopBoardState } from "@cello/domain/desktopBoard"
import type { UpdateState } from "@cello/release/updates"
import { APP_NOTICE, APP_RESTART, BOARD_COMMAND, BOARD_OPEN, BOARD_OPEN_TASK, BOARD_STATE, PANEL_CLOSE, PANEL_OPEN, UPDATE_COMMAND, UPDATE_STATE } from "../ipc.ts"
import { Panel } from "../panel/Panel.ts"
import { boardNavigationAction, boardWindowOpenAction } from "../panel/urls.ts"
import type { BoardNotice } from "../update/appUpdate.ts"
import { isBoardPage } from "./sender.ts"
import { appCommandDirection, goInHistory, type HistoryDirection, historyShortcut, swipeDirection } from "./history.ts"
import {
  clampPanelWidth,
  isTogglePanelShortcut,
  layoutViews,
  MIN_WINDOW_SIZE,
  parseWindowState,
  RELAYOUT_EVENTS,
  restoreBounds,
  type WindowState,
} from "./layout.ts"

export interface MainWindowOptions {
  readonly statePath: string
  readonly preload: string
  readonly chromePreload: string
  readonly chromeHtml: string
  readonly platform: NodeJS.Platform
  /** The board's Restart button on the app's restart notice (CEL-75). */
  readonly restartApp: () => void
  /** A command from the board's update UI (CEL-140), unchecked: main.ts checks it. */
  readonly updateCommand: (message: unknown) => void
  /** A command from Settings → Board (CEL-149), unchecked: main.ts checks it. */
  readonly boardCommand: (message: unknown) => void
  /** The window's title: the app's name (Cello, or Cello Dev). */
  readonly title: string
}

const SAVE_DELAY_MS = 400

/** The board's canvas color, so the window never flashes white before the board paints. */
const canvasColor = () => (nativeTheme.shouldUseDarkColors ? "#0e0e10" : "#f4f4f5")

const readState = (file: string): WindowState => {
  try {
    return parseWindowState(fs.readFileSync(file, "utf8"))
  } catch {
    return parseWindowState(null)
  }
}

/** A small page shown in the board's place while the server starts, or when it couldn't. */
const messagePage = (text: string, dark: boolean) => {
  const [bg, ink] = dark ? ["#0e0e10", "#8b8f98"] : ["#f4f4f5", "#6b6f76"]
  const escaped = text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>Cello</title><style>html,body{height:100%;margin:0}body{display:grid;place-items:center;background:${bg};color:${ink};font:14px/1.5 system-ui,-apple-system,sans-serif;-webkit-user-select:none}p{max-width:480px;padding:0 24px;text-align:center;white-space:pre-wrap}</style><p>${escaped}</p>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

export class MainWindow {
  readonly window: BaseWindow
  readonly board: WebContentsView
  readonly panel: Panel
  #state: WindowState
  #origin: string | null = null
  #notice: BoardNotice | null = null
  #updates: UpdateState | null = null
  #board: DesktopBoardState | null = null
  #saveTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly options: MainWindowOptions) {
    this.#state = readState(options.statePath)
    const displays = screen.getAllDisplays().map((display) => display.workArea)
    const bounds = restoreBounds(this.#state.bounds, displays)
    this.window = new BaseWindow({
      ...bounds,
      minWidth: MIN_WINDOW_SIZE.width,
      minHeight: MIN_WINDOW_SIZE.height,
      title: options.title,
      backgroundColor: canvasColor(),
      show: false,
    })
    if (this.#state.maximized) this.window.maximize()

    this.board = new WebContentsView({
      webPreferences: { preload: options.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    this.board.setBackgroundColor(canvasColor())
    this.panel = new Panel(
      {
        relayout: () => this.relayout(),
        panelWidth: () => clampPanelWidth(this.#state.panelWidth, this.window.getContentBounds().width),
        setPanelWidth: (width, persist) => {
          this.#state = { ...this.#state, panelWidth: clampPanelWidth(width, this.window.getContentBounds().width) }
          this.relayout()
          if (persist) this.#scheduleSave()
        },
        focusBoard: () => this.board.webContents.focus(),
        boardOrigin: () => this.#origin,
        openTask: (key) => this.#openTask(key),
      },
      { chromePreload: options.chromePreload, chromeHtml: options.chromeHtml },
      canvasColor(),
    )
    // Later children draw on top: the panel's page sits on its chrome.
    this.window.contentView.addChildView(this.board)
    this.window.contentView.addChildView(this.panel.chrome)
    this.window.contentView.addChildView(this.panel.page)

    this.#wireBoard(this.board.webContents)
    for (const contents of [this.board.webContents, this.panel.chrome.webContents, this.panel.page.webContents]) {
      contents.on("before-input-event", (event, input) => {
        if (isTogglePanelShortcut(input, options.platform)) {
          event.preventDefault()
          this.panel.toggle()
          return
        }
        // ⌘[ and ⌘] go back and forward in the board, or in the panel's page when the panel has focus.
        const direction = historyShortcut(input, options.platform)
        if (direction === null) return
        event.preventDefault()
        this.go(direction, contents)
      })
    }
    // A mouse's back and forward buttons (Windows, Linux; macOS reports them to the board's preload)
    // and a trackpad swipe (macOS) act on the view with focus.
    this.window.on("app-command", (_event, command) => {
      const direction = appCommandDirection(command)
      if (direction) this.go(direction, webContents.getFocusedWebContents())
    })
    this.window.on("swipe", (_event, swipe) => {
      const direction = swipeDirection(swipe)
      if (direction) this.go(direction, webContents.getFocusedWebContents())
    })

    for (const event of RELAYOUT_EVENTS) {
      this.window.on(event as "resize", () => {
        this.relayout()
        this.#scheduleSave()
      })
    }
    // The content area can also change with no window event: on Linux the menu bar takes its row
    // once the window shows. The content view says when it's laid out again.
    this.window.contentView.on("bounds-changed", () => this.relayout())
    this.window.on("move", () => this.#scheduleSave())
    this.window.on("close", () => this.#save())
    this.window.on("closed", () => {
      clearTimeout(this.#saveTimer)
      if (!this.board.webContents.isDestroyed()) this.board.webContents.close()
      this.panel.destroy()
    })

    this.relayout()
    this.window.show()
  }

  relayout(): void {
    const { width, height } = this.window.getContentBounds()
    const views = layoutViews({ width, height, panelOpen: this.panel.isOpen, panelWidth: this.#state.panelWidth })
    this.board.setBounds(views.board)
    if (views.chrome) this.panel.chrome.setBounds(views.chrome)
    if (views.page) this.panel.page.setBounds(views.page)
  }

  /** Shows a message where the board goes (starting up, or why it couldn't). */
  showMessage(text: string): void {
    void this.board.webContents.loadURL(messagePage(text, nativeTheme.shouldUseDarkColors)).catch(() => {})
  }

  /** Loads the board from the server at `origin`, at `path` (e.g. /CEL/3 for a task). */
  async loadBoard(origin: string, path = "/"): Promise<void> {
    this.#origin = origin
    await this.board.webContents.loadURL(new URL(path, origin).href).catch(() => {})
  }

  get isClosed(): boolean {
    return this.window.isDestroyed()
  }

  focus(): void {
    if (this.window.isMinimized()) this.window.restore()
    this.window.show()
    this.window.focus()
    this.board.webContents.focus()
  }

  /** What a menu command (reload, developer tools) acts on: the panel page when it has focus, else the board. */
  focusedContents(focused: WebContents | null): WebContents {
    const inPanel = focused === this.panel.page.webContents || focused === this.panel.chrome.webContents
    return inPanel && this.panel.isOpen ? this.panel.page.webContents : this.board.webContents
  }

  /** One step back or forward: in the panel's page when `focused` is the panel, else in the board. */
  go(direction: HistoryDirection, focused: WebContents | null): void {
    const target = this.focusedContents(focused)
    if (!target.isDestroyed()) goInHistory(target.navigationHistory, direction)
  }

  #wireBoard(board: WebContents): void {
    // The "Starting Cello…" message the board replaced isn't a page to go back to.
    board.on("did-navigate", () => {
      const history = board.navigationHistory
      if (history.length() > 1 && history.getEntryAtIndex(0)?.url.startsWith("data:")) history.removeEntryAtIndex(0)
    })
    board.ipc.on(PANEL_OPEN, (_event, message: unknown) => {
      const { url, title } = (message ?? {}) as { url?: unknown; title?: unknown }
      if (typeof url === "string") this.panel.open(url, typeof title === "string" ? title : undefined)
    })
    board.ipc.on(PANEL_CLOSE, () => this.panel.close())
    board.ipc.on(APP_RESTART, () => this.options.restartApp())
    // A reload starts the preload afresh: tell it the app's notice again.
    board.on("did-finish-load", () => {
      board.send(APP_NOTICE, this.#notice)
      if (this.#updates) board.send(UPDATE_STATE, this.#updates)
      if (this.#board) board.send(BOARD_STATE, this.#board)
    })
    // Commands that change the app come only from the board's own page (window/sender.ts).
    const fromBoard = (event: Electron.IpcMainEvent) => {
      const frame = event.senderFrame
      return isBoardPage(frame ? { url: frame.url, top: frame.parent === null } : null, this.#origin)
    }
    board.ipc.on(UPDATE_COMMAND, (event, message: unknown) => {
      if (fromBoard(event)) this.options.updateCommand(message)
    })
    board.ipc.on(BOARD_COMMAND, (event, message: unknown) => {
      if (fromBoard(event)) this.options.boardCommand(message)
    })
    // Links that want a new window, and links off the board's origin, open in the panel.
    board.setWindowOpenHandler(({ url }) => {
      this.#route(url, boardWindowOpenAction(url, this.#origin))
      return { action: "deny" }
    })
    board.on("will-navigate", (event, url) => {
      if (!this.#origin) return
      const action = boardNavigationAction(url, this.#origin)
      if (action === "allow") return
      event.preventDefault()
      this.#route(url, action)
    })
  }

  /** The app's restart notice (CEL-75), or null: the board shows it, and gets it again after each load. */
  showAppNotice(notice: BoardNotice | null): void {
    if (this.#notice?.key === notice?.key) return
    this.#notice = notice
    if (!this.board.webContents.isDestroyed()) this.board.webContents.send(APP_NOTICE, notice)
  }

  /** The app's update state (CEL-140): the board shows it, and gets it again after each load. */
  showUpdateState(state: UpdateState): void {
    this.#updates = state
    if (!this.board.webContents.isDestroyed()) this.board.webContents.send(UPDATE_STATE, state)
  }

  /** Which board the app uses (CEL-149): Settings → Board shows it, and gets it again after each load. */
  showBoardState(state: DesktopBoardState): void {
    this.#board = state
    if (!this.board.webContents.isDestroyed()) this.board.webContents.send(BOARD_STATE, state)
  }

  /** A task clicked in the panel: the board opens it (its router, no reload) and takes the focus; the panel stays. */
  #openTask(key: string): void {
    this.board.webContents.send(BOARD_OPEN_TASK, key)
    this.board.webContents.focus()
  }

  /**
   * A page on the board (a `cello://open` link, a ⌘-click): the board opens it in its own side panel
   * and takes the focus (CEL-60). The browser panel, if open, stays as it was.
   */
  openInBoard(url: string): void {
    this.board.webContents.send(BOARD_OPEN, url)
    this.board.webContents.focus()
  }

  #route(url: string, action: "board" | "panel" | "external" | "deny"): void {
    if (action === "board") this.openInBoard(url)
    else if (action === "panel") this.panel.open(url)
    else if (action === "external") void shell.openExternal(url)
  }

  #scheduleSave(): void {
    clearTimeout(this.#saveTimer)
    this.#saveTimer = setTimeout(() => this.#save(), SAVE_DELAY_MS)
  }

  #save(): void {
    clearTimeout(this.#saveTimer)
    if (this.window.isDestroyed()) return
    const maximized = this.window.isMaximized()
    const bounds = maximized || this.window.isFullScreen() ? this.window.getNormalBounds() : this.window.getBounds()
    this.#state = { ...this.#state, bounds, maximized }
    try {
      fs.writeFileSync(this.options.statePath, JSON.stringify(this.#state))
    } catch {}
  }
}
