// IPC between the main process and its two preloads: the board's (window.celloDesktop) and the
// panel toolbar's (window.celloPanel). Main checks each message's sender before acting on it.

/** Board → main: `{ url, title? }`, open a page in the panel. */
export const PANEL_OPEN = "cello:panel-open"
/** Board → main: close the panel. */
export const PANEL_CLOSE = "cello:panel-close"
/**
 * Main → board: a task key (`CEL-3`) clicked in the panel; open that task on the board. The preload
 * hands it to the web app as the `cello:task` message a page framed in its viewer would send.
 */
export const BOARD_OPEN_TASK = "cello:board-open-task"
/**
 * Main → board: a URL on the board's own origin (a `cello://open` link to a Cello page, a ⌘-click to
 * one), to open in the board's side panel, never the browser panel (CEL-60). The preload hands it to
 * the web app as the `cello:open` message a page framed in its viewer would send; the web app decides.
 */
export const BOARD_OPEN = "cello:board-open"

/**
 * Main → board: a `BoardNotice` (src/update/appUpdate.ts), or null, when the window takes focus and
 * after each board load: the app itself was updated, or runs from a build folder (CEL-75).
 */
export const APP_NOTICE = "cello:app-notice"
/** Board → main: restart the app (into /Applications' copy when it runs from another). */
export const APP_RESTART = "cello:app-restart"

/** Main → board: the app's `UpdateState` (packages/shared/src/updates.ts), on each change and after each board load (CEL-140). */
export const UPDATE_STATE = "cello:update-state"
/** Board → main: an `UpdateCommand` (check, download, channel, auto-download, acknowledge); main checks it with `parseUpdateCommand`. */
export const UPDATE_COMMAND = "cello:update-command"

/** Main → board: the app's `DesktopBoardState` (packages/shared/src/desktopBoard.ts) for Settings → Board, on each change and after each board load (CEL-149). */
export const BOARD_STATE = "cello:board-state"
/** Board → main: a `DesktopBoardCommand` (switch to another board); main checks it with `parseDesktopBoardCommand`. */
export const BOARD_COMMAND = "cello:board-command"

/** Toolbar → main: a button or the address field. */
export const CHROME_COMMAND = "cello:chrome-command"
/** Toolbar → main: dragging the panel's left edge, with the pointer's screen x. */
export const CHROME_RESIZE = "cello:chrome-resize"
/** Main → toolbar: what the page shows now. */
export const PANEL_STATE = "cello:panel-state"
/** Main → toolbar: put the cursor in the address field. */
export const FOCUS_ADDRESS = "cello:focus-address"

export type ChromeCommand =
  | { readonly kind: "back" | "forward" | "reload" | "stop" | "external" | "close" }
  | { readonly kind: "navigate"; readonly address: string }

export interface ResizeMessage {
  readonly phase: "start" | "move" | "end"
  readonly screenX: number
}

export interface PanelState {
  /** Whether the panel is showing; the toolbar mirrors it on <html data-panel>. */
  readonly open: boolean
  readonly url: string
  readonly title: string
  readonly canGoBack: boolean
  readonly canGoForward: boolean
  readonly loading: boolean
}

/** What the toolbar's preload exposes as `window.celloPanel`. */
export interface CelloPanelBridge {
  command(command: ChromeCommand): void
  resize(message: ResizeMessage): void
  onState(listener: (state: PanelState) => void): void
  onFocusAddress(listener: () => void): void
}
