// The side panel's way back (CEL-117). The browser's own history is the stack: every open in the side
// panel is an address (`/FE/73`, `/FE/73?viewer=/FE/pages/x`, search.ts), so reload and browser
// back/forward already work. What it can't say is which entries were reached *from* the panel; those
// get a Back control. `recordMove` keeps, per history entry, the spot it was reached from by a hop, and
// the panel shows Back while the current entry has one. Pure, so the rules are tested once here;
// panelBack.ts feeds it the router's history.
import { parseTaskPath } from "@cello/shared/taskKey"
import { withoutViewer } from "./search.ts"

/** A place in the app: its path and its (parsed) search params. */
export interface Spot {
  readonly pathname: string
  readonly search: Readonly<Record<string, unknown>>
}

/**
 * What the side panel shows at a spot: the viewer's item, a task (docked beside its board, or in the
 * viewer of another page, CEL-141), or nothing.
 */
export type SideContent = { readonly type: "viewer"; readonly url: string } | { readonly type: "task"; readonly key: string } | null

const BOARD = "http://board.invalid"

const taskContent = (pathname: string): SideContent => {
  const task = parseTaskPath(pathname)
  return task ? { type: "task", key: `${task.projectKey}-${task.number}` } : null
}

export const sideOf = (spot: Spot): SideContent => {
  const viewer = spot.search["viewer"]
  if (typeof viewer === "string" && viewer !== "") {
    // The viewer's address is a path on the board, or another site's absolute URL (search.ts).
    const onBoard = URL.parse(viewer, BOARD)
    return (onBoard?.origin === BOARD ? taskContent(onBoard.pathname) : null) ?? { type: "viewer", url: viewer }
  }
  return spot.search["view"] !== "full" ? taskContent(spot.pathname) : null
}

const sameContent = (a: NonNullable<SideContent>, b: NonNullable<SideContent>): boolean =>
  a.type === "viewer" ? b.type === "viewer" && a.url === b.url : b.type === "task" && a.key === b.key

/**
 * A hop: a click inside the panel (or the task beside it) swapped what the panel shows for something
 * else. Opening from the board, the Docs tab or a `cello open` link isn't one, nor is emptying the panel.
 */
export const isHop = (from: Spot, to: Spot, fromPanel: boolean): boolean => {
  const before = sideOf(from)
  const after = sideOf(to)
  return fromPanel && before !== null && after !== null && !sameContent(before, after)
}

const canonical = (search: Spot["search"]): string =>
  JSON.stringify(
    Object.keys(search)
      .filter((key) => search[key] !== undefined)
      .sort()
      .map((key) => [key, search[key]]),
  )

/** The same address, whatever the order of its params. */
export const sameSpot = (a: Spot, b: Spot): boolean => a.pathname === b.pathname && canonical(a.search) === canonical(b.search)

/** Per history entry key, the spot a hop reached it from; insertion-ordered, the newest last. */
export type Hops = Readonly<Record<string, Spot>>

export const MAX_HOPS = 100

export interface Move {
  readonly type: "PUSH" | "REPLACE" | "BACK" | "FORWARD" | "GO"
  readonly from: { readonly key: string; readonly spot: Spot }
  readonly to: { readonly key: string; readonly spot: Spot }
  /** The last click before it was inside the side panel or the open task. */
  readonly fromPanel: boolean
}

const capped = (hops: Record<string, Spot>): Hops => {
  const keys = Object.keys(hops)
  return keys.length <= MAX_HOPS ? hops : Object.fromEntries(keys.slice(-MAX_HOPS).map((key) => [key, hops[key]!]))
}

/**
 * The records after a history move: a hop records where it came from; a replace hands the entry's
 * record to its new key while the panel still shows something; back, forward and go change nothing
 * (the entries they land on keep theirs). Unchanged records are returned as they were.
 */
export const recordMove = (hops: Hops, move: Move): Hops => {
  if (move.type === "PUSH") return isHop(move.from.spot, move.to.spot, move.fromPanel) ? capped({ ...hops, [move.to.key]: move.from.spot }) : hops
  if (move.type !== "REPLACE") return hops
  const back = hops[move.from.key]
  if (back === undefined) return hops
  const { [move.from.key]: _, ...rest } = hops
  return sideOf(move.to.spot) !== null ? capped({ ...rest, [move.to.key]: back }) : rest
}

/** Where Back goes from history entry `key`, or undefined when it wasn't reached by a hop. */
export const backOf = (hops: Hops, key: string | undefined): Spot | undefined => (key === undefined ? undefined : hops[key])

/**
 * How closing the viewer at `current` (entry `key`) goes: back, when the entry before it is exactly
 * the layout without the viewer (the task back in the panel); else a replace with that layout, so the
 * entry just closed doesn't linger as a Back.
 */
export const closeMove = (hops: Hops, key: string | undefined, current: Spot): "back" | "replace" => {
  const back = backOf(hops, key)
  const closed: Spot = { pathname: current.pathname, search: withoutViewer(current.search) }
  return back !== undefined && sameSpot(back, closed) ? "back" : "replace"
}
