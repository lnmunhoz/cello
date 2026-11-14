// Where each view sits in the main window, how wide the panel may be, the saved window state, and
// the panel's keyboard shortcut. Pure, so MainWindow only applies the numbers.

export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

/** Height of the panel's toolbar; the page sits below it. */
export const TOOLBAR_HEIGHT = 40
/** Width of the panel's left edge, which is dragged to resize it. */
export const EDGE_WIDTH = 5
export const MIN_PANEL_WIDTH = 320
export const MIN_BOARD_WIDTH = 400
export const DEFAULT_PANEL_WIDTH = 560
export const DEFAULT_WINDOW_SIZE = { width: 1440, height: 900 } as const
export const MIN_WINDOW_SIZE = { width: 800, height: 560 } as const

/**
 * The board fills the window, less the panel when it's open. The panel's chrome view (edge and
 * toolbar) covers the whole panel area behind the page, so its edge shows left of the page.
 */
export const layoutViews = (options: {
  readonly width: number
  readonly height: number
  readonly panelOpen: boolean
  readonly panelWidth: number
}): { board: Rect; chrome: Rect | null; page: Rect | null } => {
  const { width, height } = options
  if (!options.panelOpen) return { board: { x: 0, y: 0, width, height }, chrome: null, page: null }
  const panel = clampPanelWidth(options.panelWidth, width)
  const left = width - panel
  return {
    board: { x: 0, y: 0, width: left, height },
    chrome: { x: left, y: 0, width: panel, height },
    page: { x: left + EDGE_WIDTH, y: TOOLBAR_HEIGHT, width: panel - EDGE_WIDTH, height: Math.max(0, height - TOOLBAR_HEIGHT) },
  }
}

/** Both the panel and the board keep their minimum width; a window too narrow for both is split in half. */
export const clampPanelWidth = (width: number, windowWidth: number): number => {
  const max = Math.max(windowWidth - MIN_BOARD_WIDTH, Math.floor(windowWidth / 2))
  return Math.round(Math.min(Math.max(width, MIN_PANEL_WIDTH), max))
}

export interface WindowState {
  readonly bounds?: Rect
  readonly maximized: boolean
  readonly panelWidth: number
}

const isRect = (value: unknown): value is Rect =>
  typeof value === "object" && value !== null &&
  (["x", "y", "width", "height"] as const).every((k) => Number.isFinite((value as Record<string, unknown>)[k]))

/** The saved window state (window-state.json), with defaults for anything missing or broken. */
export const parseWindowState = (text: string | null): WindowState => {
  let saved: Record<string, unknown> = {}
  try {
    const parsed: unknown = text === null ? {} : JSON.parse(text)
    if (typeof parsed === "object" && parsed !== null) saved = parsed as Record<string, unknown>
  } catch {}
  const panelWidth = typeof saved.panelWidth === "number" && saved.panelWidth >= MIN_PANEL_WIDTH ? saved.panelWidth : DEFAULT_PANEL_WIDTH
  return {
    ...(isRect(saved.bounds) ? { bounds: saved.bounds } : {}),
    maximized: saved.maximized === true,
    panelWidth,
  }
}

// A window snapped to a display edge can be reported 1px past it (as in T3 Code).
const EDGE_TOLERANCE = 1

const fits = (window: Rect, display: Rect) =>
  window.x >= display.x - EDGE_TOLERANCE &&
  window.y >= display.y - EDGE_TOLERANCE &&
  window.x + window.width <= display.x + display.width + EDGE_TOLERANCE &&
  window.y + window.height <= display.y + display.height + EDGE_TOLERANCE

/** The saved bounds if they still fit on a connected display, else the default size (centred by Electron). */
export const restoreBounds = (saved: Rect | undefined, displays: ReadonlyArray<Rect>): Rect | typeof DEFAULT_WINDOW_SIZE =>
  saved && displays.some((display) => fits(saved, display)) ? saved : DEFAULT_WINDOW_SIZE

/** The fields of Electron's `Input` the shortcut needs. */
export interface KeyInput {
  readonly type: string
  readonly key: string
  readonly code?: string
  readonly meta: boolean
  readonly control: boolean
  readonly alt: boolean
  readonly shift: boolean
}

/** ⌘\ on macOS (Ctrl+\ elsewhere) toggles the panel. Matched by key code too, for other layouts. */
export const isTogglePanelShortcut = (input: KeyInput, platform: string): boolean => {
  const mod = platform === "darwin" ? input.meta && !input.control : input.control && !input.meta
  return input.type === "keyDown" && mod && !input.alt && !input.shift && (input.key === "\\" || input.code === "Backslash")
}
