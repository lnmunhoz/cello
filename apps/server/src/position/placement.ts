// Where an item lands among its siblings (tasks in a column, statuses in a workspace), given the ids
// of the neighbor that should come before it and the one after it. Pure; callers load the group.
import { positionBetween } from "@cello/domain/position"

export interface Placed {
  readonly id: string
  readonly position: string
}

export type Placement =
  | { readonly _tag: "Placed"; readonly position: string; readonly unchanged: boolean }
  | { readonly _tag: "BadNeighbor"; readonly field: "before" | "after"; readonly reason: string }

/**
 * `before` is the item that should sit right above, `after` the one right below. With neither, the
 * item goes to the bottom. The gap is narrowed to the nearest sibling, so the new position never
 * equals one that's already used (archived items count as siblings). An item that already sits in
 * the gap stays put (`unchanged`).
 */
export const place = (
  siblings: ReadonlyArray<Placed>,
  options: {
    readonly self?: Placed | undefined
    readonly before?: string | null | undefined
    readonly after?: string | null | undefined
  },
): Placement => {
  const others = siblings.filter((s) => s.id !== options.self?.id)
  const find = (field: "before" | "after", id: string | null | undefined) => {
    if (id === null || id === undefined) return { ok: true as const, position: null }
    const found = others.find((s) => s.id === id)
    return found
      ? { ok: true as const, position: found.position }
      : { ok: false as const, error: { _tag: "BadNeighbor" as const, field, reason: `${id} is not in this column` } }
  }
  const before = find("before", options.before)
  if (!before.ok) return before.error
  const after = find("after", options.after)
  if (!after.ok) return after.error

  let lo = before.position
  let hi = after.position
  if (lo !== null && hi !== null && lo >= hi) {
    return { _tag: "BadNeighbor", field: "after", reason: `${options.before} must come before ${options.after}` }
  }
  const positions = others.map((s) => s.position)
  if (lo === null && hi === null) {
    lo = positions.reduce<string | null>((max, p) => (max === null || p > max ? p : max), null)
  } else if (lo !== null) {
    for (const p of positions) if (p > lo && (hi === null || p < hi)) hi = p
  } else {
    for (const p of positions) if (p < hi! && (lo === null || p > lo)) lo = p
  }

  const current = options.self?.position
  if (current !== undefined && (lo === null || current > lo) && (hi === null || current < hi)) {
    return { _tag: "Placed", position: current, unchanged: true }
  }
  return { _tag: "Placed", position: positionBetween(lo, hi), unchanged: false }
}
