// Which card a drop moved, from the board's lists before and after it.
export type Lists = Readonly<Record<string, ReadonlyArray<string>>>

export interface Move {
  readonly key: string
  readonly to: string
  readonly index: number
}

const locate = (lists: Lists, key: string) => {
  for (const [list, keys] of Object.entries(lists)) {
    const index = keys.indexOf(key)
    if (index !== -1) return { list, index }
  }
  return null
}

/** The moved card and where it landed. `hint` is the key the drag reported, when it did. */
export const findMove = (prev: Lists, next: Lists, hint?: string): Move | null => {
  if (hint) {
    const at = locate(next, hint)
    const was = locate(prev, hint)
    if (at && (!was || was.list !== at.list || was.index !== at.index)) return { key: hint, to: at.list, index: at.index }
  }
  // A card that changed column.
  for (const [list, keys] of Object.entries(next)) {
    for (const [index, key] of keys.entries()) {
      if (locate(prev, key)?.list !== list) return { key, to: list, index }
    }
  }
  // Within one column: the card whose neighbors changed most, i.e. the one that jumped.
  for (const [list, keys] of Object.entries(next)) {
    const before = prev[list] ?? []
    if (keys.every((k, i) => before[i] === k)) continue
    const first = keys.findIndex((k, i) => before[i] !== k)
    const last = keys.length - 1 - [...keys].reverse().findIndex((k, i) => before[before.length - 1 - i] !== k)
    // Moved down: the old first differing card now sits at `last`. Moved up: the old last one sits at `first`.
    if (before[first] === keys[last]) return { key: keys[last]!, to: list, index: last }
    return { key: keys[first]!, to: list, index: first }
  }
  return null
}
