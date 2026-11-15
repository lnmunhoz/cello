// The left sidebar: expanded (as wide as you dragged it), collapsed to a rail of icons, or hidden.
// Remembered on this device. Pure, so the rules are tested once here; Sidebar.tsx renders them.
import type { WidthRule } from "../lib/resize.ts"

export type SidebarMode = "expanded" | "rail" | "hidden"

export interface SidebarState {
  readonly mode: SidebarMode
  /** What ⌘B collapses it to: the last way it was collapsed with a button. */
  readonly collapsed: "rail" | "hidden"
}

export const DEFAULT_SIDEBAR: SidebarState = { mode: "expanded", collapsed: "rail" }

export const SIDEBAR_KEY = "cello:sidebar"
export const SIDEBAR_WIDTH_KEY = "cello:sidebar-width"
/** ⌘B on a Mac, Ctrl+B elsewhere: free in Chrome, Safari and the desktop app's menus (⌘\ is the desktop panel's). */
export const SIDEBAR_SHORTCUT = "mod+b"

/** In px. It starts as wide as it always was. */
export const SIDEBAR_WIDTH: WidthRule = { initial: 240, min: 200, max: 400, minRest: 480, step: 16 }

const MODES: ReadonlyArray<string> = ["expanded", "rail", "hidden"]

/** What localStorage holds, field by field, with the default for anything missing or broken. */
export const readSidebar = (stored: string | null): SidebarState => {
  let saved: Record<string, unknown> = {}
  try {
    const parsed: unknown = stored === null ? null : JSON.parse(stored)
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) saved = parsed as Record<string, unknown>
  } catch {}
  const mode = typeof saved.mode === "string" && MODES.includes(saved.mode) ? (saved.mode as SidebarMode) : DEFAULT_SIDEBAR.mode
  const collapsed = saved.collapsed === "rail" || saved.collapsed === "hidden" ? saved.collapsed : mode === "hidden" ? "hidden" : "rail"
  return { mode, collapsed }
}

export const writeSidebar = (state: SidebarState): string => JSON.stringify(state)

/** Below this window width (px) the sidebar starts as the rail. */
export const NARROW_WIDTH = 768

/**
 * What the sidebar shows. In a narrow window an expanded sidebar shows as the rail, unless it was
 * expanded on purpose there (`expandedHere`); that rail is never saved, so a wide window shows the
 * saved state again. Buttons and ⌘B act on what's shown.
 */
export const shownSidebar = (state: SidebarState, window: { readonly narrow: boolean; readonly expandedHere: boolean }): SidebarState =>
  window.narrow && !window.expandedHere && state.mode === "expanded" ? { ...state, mode: "rail" } : state

/** A button's choice. Collapsing one way makes that the way ⌘B collapses it next time. */
export const setSidebarMode = (state: SidebarState, mode: SidebarMode): SidebarState =>
  mode === "expanded" ? { ...state, mode } : { mode, collapsed: mode }

/** ⌘B: the expanded sidebar collapses (to the rail, or hidden if that's how it was last collapsed); a collapsed one expands. */
export const toggleSidebar = (state: SidebarState): SidebarState =>
  state.mode === "expanded" ? { ...state, mode: state.collapsed } : { ...state, mode: "expanded" }
