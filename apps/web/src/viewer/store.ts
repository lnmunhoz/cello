// What the web viewer panel shows: one item or nothing. A plain store rather than an atom, so
// `openInPanel` works from any click handler without a registry.
import { useSyncExternalStore } from "react"
import type { ViewerItem } from "./viewer.ts"

let current: ViewerItem | null = null
const listeners = new Set<() => void>()

const set = (item: ViewerItem | null) => {
  current = item
  for (const listener of listeners) listener()
}

export const viewerItem = (): ViewerItem | null => current

export const showInViewer = (item: ViewerItem): void => set(item)

export const closeViewer = (): void => set(null)

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The item the viewer shows, or null when it's closed. */
export const useViewerItem = (): ViewerItem | null => useSyncExternalStore(subscribe, viewerItem)
