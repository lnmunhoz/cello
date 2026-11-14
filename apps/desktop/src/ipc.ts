// IPC between the main process and its two preloads: the board's (window.celloDesktop) and the
// panel toolbar's (window.celloPanel). Main checks each message's sender before acting on it.

/** Board → main: `{ url, title? }`, open a page in the panel. */
export const PANEL_OPEN = "cello:panel-open"
/** Board → main: close the panel. */
export const PANEL_CLOSE = "cello:panel-close"

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
