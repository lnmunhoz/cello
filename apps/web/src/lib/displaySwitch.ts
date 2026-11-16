// An on/off Display option kept on this device ("Show agent cursors", "Needs input column"): read once,
// written on change, and every component showing it re-renders when any of them flips it.
import { useSyncExternalStore } from "react"
import { readStored, writeStored } from "./storage.ts"

export interface DisplaySwitch {
  readonly get: () => boolean
  readonly set: (on: boolean) => void
  readonly use: () => boolean
}

export const displaySwitch = (key: string, fallback: boolean): DisplaySwitch => {
  const stored = readStored(key)
  let on = stored === null ? fallback : stored === "on"
  const listeners = new Set<() => void>()
  const subscribe = (onChange: () => void) => {
    listeners.add(onChange)
    return () => {
      listeners.delete(onChange)
    }
  }
  const get = () => on
  return {
    get,
    set: (next) => {
      if (next === on) return
      on = next
      writeStored(key, next ? "on" : "off")
      for (const l of listeners) l()
    },
    // `get` serves as the server snapshot too, so a card renders to static markup in unit tests.
    use: () => useSyncExternalStore(subscribe, get, get),
  }
}
