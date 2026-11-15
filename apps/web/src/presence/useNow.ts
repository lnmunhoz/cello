// One clock for every "active now", "seen 4m ago" and "changed 2h ago" on screen: it ticks every
// TICK_MS while something shows one, and stops when nothing does. A tick re-renders those words only;
// it starts no animation.
import { useSyncExternalStore } from "react"

const TICK_MS = 30_000

let now = Date.now()
let timer: ReturnType<typeof setInterval> | null = null
const listeners = new Set<() => void>()

const subscribe = (onChange: () => void) => {
  listeners.add(onChange)
  if (timer === null) {
    now = Date.now()
    timer = setInterval(() => {
      now = Date.now()
      for (const l of listeners) l()
    }, TICK_MS)
  }
  return () => {
    listeners.delete(onChange)
    if (listeners.size === 0 && timer !== null) {
      clearInterval(timer)
      timer = null
    }
  }
}

const read = () => now

/**
 * The time, at most TICK_MS old; components showing relative times read it so they move on by
 * themselves. Rendered outside a browser (the unit tests render cards to markup), the time right now.
 */
export const useNow = (): number => useSyncExternalStore(subscribe, read, Date.now)
