import type { WidthRule } from "../lib/resize.ts"

// How an open task shows: the side panel beside the board (the default, no param) or a full page in the
// main area (`/CEL/27?view=full`). It lives in the URL, so a reload and a link keep it.
export type TaskView = "panel" | "full"

export interface TaskSearch {
  readonly view?: "full"
  /** A comment to scroll to and flash once (opened from ⌘K, CEL-43). */
  readonly comment?: string
}

/** The task route's `validateSearch`: keeps `view=full` and `comment=<id>`, and drops anything it doesn't know. */
export const parseTaskSearch = (search: Record<string, unknown>): TaskSearch => ({
  ...(search["view"] === "full" ? { view: "full" as const } : {}),
  ...(typeof search["comment"] === "string" && search["comment"] !== "" ? { comment: search["comment"] } : {}),
})

export const taskViewOf = (search: TaskSearch): TaskView => search.view ?? "panel"

/** The search to navigate with. The panel sets `view` to undefined, which removes the param. */
export const searchForView = (view: TaskView): TaskSearch => ({ view: view === "full" ? "full" : undefined })

export const toggledView = (view: TaskView): TaskView => (view === "full" ? "panel" : "full")

/**
 * The class for the board or list behind an open task: hidden behind a task in the main area (still
 * mounted, so folded groups and focus survive), and behind the panel only in a narrow window, where the
 * panel takes its place.
 */
export const behindTask = (placement: TaskPlacement): "" | "hidden" | "max-md:hidden" =>
  placement === "none" ? "" : placement === "page" ? "hidden" : "max-md:hidden"

/** Toggles the view while a task is open; a plain key, so it never fires while typing. */
export const TASK_VIEW_SHORTCUT = "f"

/**
 * Where the open task sits in the project layout (project/ProjectLayout.tsx): docked on the right of
 * the main area at full height ("side"), as a page under the tabs in the board's place ("page"), or
 * nowhere. Expanded, or while the viewer is open: opening a page from the task moves the task to the
 * main area with the page beside it, so neither covers the other (CEL-117); closing the viewer docks
 * it again. Below 768 px a docked task takes the board's place too; that part is CSS (`md:`).
 */
export type TaskPlacement = "none" | "side" | "page"

export const taskPlacement = (taskOpen: boolean, view: TaskView, viewerOpen: boolean): TaskPlacement =>
  !taskOpen ? "none" : view === "full" || viewerOpen ? "page" : "side"

/**
 * What Expand / Collapse (and F) do where the task is: docked, it expands to a full page; in the main
 * area, it collapses to the panel, closing the viewer beside it (else the viewer would keep it there).
 */
export const viewToggle = (placement: "side" | "page"): { view: TaskView; closeViewer: boolean } =>
  placement === "side" ? { view: "full", closeViewer: false } : { view: "panel", closeViewer: true }

/** The docked panel's width, dragged by its left edge; the board or list beside it keeps 360px. */
export const TASK_PANEL_WIDTH: WidthRule = { initial: 560, min: 360, max: 960, minRest: 360, step: 32 }

/** Where this device remembers it, shared by the board and the list. */
export const TASK_PANEL_WIDTH_KEY = "cello:task-panel-width"
