// A move waiting in an agent's queue keeps showing the card in its old slot: a "hole", a static copy
// React renders in the old column, so it reflows with that column like a real card would. Pure.

export interface Hole {
  readonly id: number
  readonly card: string
  /** The column it was in. */
  readonly statusId: string
  /** The card shown just above it when it was recorded (null: it was first). */
  readonly after: string | null
  /** Its place in the column then, for when `after` is gone. */
  readonly index: number
  /** Taken over by the flying copy: it keeps its space but shows nothing. */
  readonly hidden: boolean
}

export interface Slot {
  readonly key: string
  readonly hole?: Hole
}

/**
 * The holes without `id`. A hole that followed the closed one takes its place (the card the closed
 * one followed), so it stays where it is instead of falling back to a stale index.
 */
export const closeHole = (holes: ReadonlyArray<Hole>, id: number): Hole[] => {
  const closed = holes.find((h) => h.id === id)
  if (!closed) return [...holes]
  return holes.filter((h) => h.id !== id).map((h) => (h.after === closed.card && h.statusId === closed.statusId ? { ...h, after: closed.after } : h))
}

/** A column's cards with its holes put back after the card each one followed. */
export const withHoles = (cards: ReadonlyArray<string>, holes: ReadonlyArray<Hole>): Slot[] => {
  const slots: Slot[] = cards.map((key) => ({ key }))
  if (holes.length === 0) return slots
  let left = [...holes]
  // A hole can follow another hole, so place them in rounds until no more find their card.
  for (let progress = true; left.length > 0 && progress; ) {
    progress = false
    left = left.filter((h) => {
      const at = h.after === null ? 0 : slots.findIndex((s) => s.key === h.after) + 1
      if (h.after !== null && at === 0) return true
      slots.splice(at, 0, { key: h.card, hole: h })
      progress = true
      return false
    })
  }
  for (const h of left) slots.splice(Math.min(slots.length, h.index), 0, { key: h.card, hole: h })
  return slots
}
