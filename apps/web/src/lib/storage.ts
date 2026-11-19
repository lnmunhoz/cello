// This device's saved settings (theme, sidebar, panel widths) in localStorage. Storage can be missing
// or throw (a private window, blocked site data): reads give null and writes do nothing, never an error.
import { useSyncExternalStore } from "react"

const listeners = new Map<string, Set<() => void>>()

export const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export const writeStored = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {}
  for (const listener of listeners.get(key) ?? []) listener()
}

/** Removes `key`, telling the components that show it. */
export const removeStored = (key: string): void => {
  try {
    localStorage.removeItem(key)
  } catch {}
  for (const listener of listeners.get(key) ?? []) listener()
}

/** Every saved key that starts with `prefix`. */
export const storedKeys = (prefix: string): string[] => {
  try {
    return Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((key): key is string => key !== null && key.startsWith(prefix))
  } catch {
    return []
  }
}

/** Calls `listener` after each write to `key` from this page. Returns the unsubscribe. */
export const subscribeStored = (key: string, listener: () => void): (() => void) => {
  const set = listeners.get(key) ?? new Set()
  set.add(listener)
  listeners.set(key, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(key)
  }
}

/** A saved setting, re-rendering every component that shows it when any of them writes it. */
export const useStored = (key: string): string | null =>
  useSyncExternalStore(
    (listener) => subscribeStored(key, listener),
    () => readStored(key),
  )
