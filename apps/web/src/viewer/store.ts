// What the web viewer panel shows: one item or nothing, read from the URL (`?viewer=…`, search.ts), so
// a reload and browser back/forward keep it and the side panel's Back can return to it (CEL-117).
// `showInViewer` and `closeViewer` work from any click handler: they go through the driver the viewer
// panel installs (panelBack.ts's `routerViewerDriver`), or, outside the app (unit tests), a plain
// in-memory one.
import { useSearch } from "@tanstack/react-router"
import { viewerItemOf, type ViewerSearch } from "./search.ts"
import type { ViewerItem } from "./viewer.ts"

export interface ViewerDriver {
  readonly current: () => ViewerItem | null
  /** `replace`: in place of the open item (a version picked, a file's real kind), not a new history entry. */
  readonly show: (item: ViewerItem, replace: boolean) => void
  readonly close: () => void
}

let shown: ViewerItem | null = null
const memory: ViewerDriver = {
  current: () => shown,
  show: (item) => {
    shown = item
  },
  close: () => {
    shown = null
  },
}

let driver = memory

/** Makes `next` the way the viewer opens and closes; returns the undo. */
export const setViewerDriver = (next: ViewerDriver): (() => void) => {
  driver = next
  return () => {
    if (driver === next) driver = memory
  }
}

export const viewerItem = (): ViewerItem | null => driver.current()

export const showInViewer = (item: ViewerItem, options?: { readonly replace?: boolean }): void => driver.show(item, options?.replace ?? false)

export const closeViewer = (): void => driver.close()

/** The item the viewer shows, or null when it's closed. */
export const useViewerItem = (): ViewerItem | null => viewerItemOf(useSearch({ strict: false }) as ViewerSearch, location.origin)
