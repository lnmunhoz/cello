// Back and forward in the main window (CEL-54): which input means which way, pure so the rules are
// tested here, plus the one step that moves a view's history. MainWindow and the menu wire them up.
import type { NavigationHistory } from "electron"
import type { KeyInput } from "./layout.ts"

export type HistoryDirection = "back" | "forward"

/** ⌘[ goes back and ⌘] forward on macOS (Ctrl elsewhere), as in Safari and Chrome. Matched by key position too, for other layouts. */
export const historyShortcut = (input: KeyInput, platform: string): HistoryDirection | null => {
  const mod = platform === "darwin" ? input.meta && !input.control : input.control && !input.meta
  if (input.type !== "keyDown" || !mod || input.alt || input.shift) return null
  if (input.key === "[" || input.code === "BracketLeft") return "back"
  if (input.key === "]" || input.code === "BracketRight") return "forward"
  return null
}

/** A mouse's back and forward buttons on Windows and Linux, which Electron reports as app commands. */
export const appCommandDirection = (command: string): HistoryDirection | null =>
  command === "browser-backward" ? "back" : command === "browser-forward" ? "forward" : null

/**
 * What the board's preload does with a mouse button as the page sees it (`MouseEvent.button`): 3 goes
 * back and 4 forward, on macOS only, which reports them nowhere else. On Windows and Linux they arrive
 * as app commands (`appCommandDirection`), so the preload leaves them alone and the board moves once.
 */
export const mouseButtonDirection = (button: number, platform: string): HistoryDirection | null => {
  if (platform !== "darwin") return null
  return button === 3 ? "back" : button === 4 ? "forward" : null
}

/** A trackpad swipe on macOS (Electron's `swipe`, with "Swipe between pages" set to swipe): left goes back, right forward. */
export const swipeDirection = (direction: string): HistoryDirection | null =>
  direction === "left" ? "back" : direction === "right" ? "forward" : null

/** Moves a view one step back or forward, when there's somewhere to go. */
export const goInHistory = (
  history: Pick<NavigationHistory, "canGoBack" | "canGoForward" | "goBack" | "goForward">,
  direction: HistoryDirection,
): void => {
  if (direction === "back" && history.canGoBack()) history.goBack()
  else if (direction === "forward" && history.canGoForward()) history.goForward()
}
