// One clock for every "active now", "seen 4m ago" and "changed 2h ago" on screen: it ticks every
// TICK_MS while something shows one, and stops when nothing does. A tick re-renders those words only;
// it starts no animation.
import { useEffect, useState, useSyncExternalStore } from "react"

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

/**
 * The time for a countdown to `due` (CEL-136: a wake due in 30 s): it ticks every second until `due`,
 * then stops, and with no `due` it's useNow's. Only a wake that's pending re-renders each second; an
 * idle board runs nothing (AGENTS.md).
 */
export const useCountdownNow = (due: number | null): number => {
  const slow = useNow()
  const [fast, setFast] = useState(() => Date.now())
  useEffect(() => {
    if (due === null) return
    setFast(Date.now())
    const timer = setInterval(() => {
      const t = Date.now()
      setFast(t)
      if (t >= due) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [due])
  return due === null ? slow : Math.max(slow, fast)
}
