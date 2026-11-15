// Display → "Show agent cursors": on unless turned off on this device.
import { useSyncExternalStore } from "react"
import { readStored, writeStored } from "../../lib/storage.ts"

const KEY = "cello:agent-cursors"

let shown = readStored(KEY) !== "off"
const listeners = new Set<() => void>()

export const agentCursorsShown = (): boolean => shown

export const showAgentCursors = (on: boolean): void => {
  if (on === shown) return
  shown = on
  writeStored(KEY, on ? "on" : "off")
  for (const l of listeners) l()
}

const subscribe = (onChange: () => void) => {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

export const useAgentCursorsShown = (): boolean => useSyncExternalStore(subscribe, agentCursorsShown)
