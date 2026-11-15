// What each task's agent mark last drew (CEL-69), so a change seen on screen plays its entry and one
// nobody saw doesn't. A card that changes column is a new component that mounts while the old one is
// still there, so it reads what the old one drew. A card that left the screen (another page, a filter)
// counts only for BASELINE_MS after it went: coming back later is like a page load, nothing plays.
// Pure, with the clock passed in.

/** How long after a card leaves the screen what it drew still counts: covers a column move. */
export const BASELINE_MS = 2_000

export interface DrawnMarks<T> {
  /** The card drew `value` and is on screen. */
  readonly seen: (id: string, value: T) => void
  /** The card left the screen at `now`. Also forgets every card gone longer than BASELINE_MS. */
  readonly left: (id: string, now: number) => void
  /** What the card last drew, if it's on screen or left within BASELINE_MS; else undefined. */
  readonly baseline: (id: string, now: number) => T | undefined
  readonly size: () => number
}

export const drawnMarks = <T>(): DrawnMarks<T> => {
  const entries = new Map<string, { value: T; leftAt: number | null }>()
  const fresh = (leftAt: number | null, now: number) => leftAt === null || now - leftAt <= BASELINE_MS
  return {
    seen: (id, value) => {
      entries.set(id, { value, leftAt: null })
    },
    left: (id, now) => {
      const entry = entries.get(id)
      if (entry) entries.set(id, { ...entry, leftAt: now })
      for (const [key, e] of entries) if (!fresh(e.leftAt, now)) entries.delete(key)
    },
    baseline: (id, now) => {
      const entry = entries.get(id)
      return entry && fresh(entry.leftAt, now) ? entry.value : undefined
    },
    size: () => entries.size,
  }
}
