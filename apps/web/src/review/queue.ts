// The Review page's rules, kept pure: which row is open (it lives in the URL, `?open=CEL-12`), which
// opens after a decision, the keys that move between rows, and the note a decision sends.
import { formatTaskKey, parseTaskKey } from "@cello/shared/taskKey"

export interface ReviewSearch {
  /** The task whose packet is open; none: every row is collapsed. */
  readonly open?: string
}

export const parseReviewSearch = (search: Record<string, unknown>): ReviewSearch => {
  const task = typeof search["open"] === "string" ? parseTaskKey(search["open"]) : null
  return task ? { open: formatTaskKey(task.projectKey, task.number) } : {}
}

/** The row that opens once `decided` leaves the queue: the next one, else the one before, else none. */
export const nextAfterDecision = (keys: ReadonlyArray<string>, decided: string): string | undefined => {
  const at = keys.indexOf(decided)
  return at === -1 ? undefined : (keys[at + 1] ?? keys[at - 1])
}

const ROW_KEYS: Readonly<Record<string, string>> = { j: "ArrowDown", k: "ArrowUp" }

/** j and k move between rows as ↓ and ↑ do (for `nextRow`); other keys stay as they are. */
export const rowKey = (key: string): string => ROW_KEYS[key] ?? key

/**
 * The note Send back or Approve sends on the Review page (CEL-70): the comment box's text, trimmed.
 * An empty box has none (null): Send back asks for one instead, Approve goes without.
 */
export const decisionNote = (text: string): string | null => {
  const note = text.trim()
  return note === "" ? null : note
}

/** What Lucas decided about a packet, as the server names it. */
export type Decision = "approved" | "sent_back"

/** What the row says once the server took the decision. */
export const DECISION_LABEL: Readonly<Record<Decision, string>> = { approved: "Approved", sent_back: "Sent back" }

/**
 * A row's decision, from the click until the row has left (CEL-187): pending while the command runs;
 * then decided (the row says "Approved" or "Sent back" for a moment), leaving (it folds away) and gone;
 * or failed, with the message, until another click tries again.
 */
export type DecisionState =
  | { readonly phase: "idle" }
  | { readonly phase: "pending"; readonly decision: Decision }
  | { readonly phase: "failed"; readonly decision: Decision; readonly message: string }
  | { readonly phase: "decided"; readonly decision: Decision }
  | { readonly phase: "leaving"; readonly decision: Decision }
  | { readonly phase: "gone" }

export const IDLE: DecisionState = { phase: "idle" }

export type DecisionEvent =
  /** Approve or Send back was clicked. */
  | { readonly type: "clicked"; readonly decision: Decision }
  /** The server took the decision. */
  | { readonly type: "taken" }
  /** The command failed. */
  | { readonly type: "refused"; readonly message: string }
  /** The confirmation has been on the row for its moment. */
  | { readonly type: "shown" }
  /** The row has folded away. */
  | { readonly type: "left" }

/** The next state; an event out of turn (a second click while pending) changes nothing. */
export const decisionStep = (state: DecisionState, event: DecisionEvent): DecisionState => {
  switch (event.type) {
    case "clicked":
      return state.phase === "idle" || state.phase === "failed" ? { phase: "pending", decision: event.decision } : state
    case "taken":
      return state.phase === "pending" ? { phase: "decided", decision: state.decision } : state
    case "refused":
      return state.phase === "pending" ? { phase: "failed", decision: state.decision, message: event.message } : state
    case "shown":
      return state.phase === "decided" ? { phase: "leaving", decision: state.decision } : state
    case "left":
      return state.phase === "leaving" ? { phase: "gone" } : state
  }
}

/**
 * A row the page keeps from the click on: the item as it was, and where it stood (`at`) among the rows
 * shown. The decision's events can reach the page before the command's answer does, so the row is held
 * while it's pending, too.
 */
export interface Held<Item> {
  readonly key: string
  readonly item: Item
  readonly at: number
  readonly state: DecisionState
  /**
   * The queue has stopped listing the row since the click: the decision's events arrived (`syncHeld`).
   * Until then the queue's own copy is the one decided; listed again after that, it's a new packet.
   */
  readonly dropped: boolean
}

/**
 * A held row after `event` on the row `key`. A row whose decision failed is let go. So is one that
 * has left, once the queue has dropped it; before that it's kept (gone), out of the list, so it
 * doesn't pop back when the fold ends before the decision's events arrive.
 */
export const holdStep = <Item>(held: ReadonlyArray<Held<Item>>, key: string, event: DecisionEvent): Held<Item>[] =>
  held.flatMap((h) => {
    if (h.key !== key) return [h]
    const state = decisionStep(h.state, event)
    if (state.phase === "idle" || state.phase === "failed" || (state.phase === "gone" && h.dropped)) return []
    return [state === h.state ? h : { ...h, state }]
  })

/**
 * Every leaving row has left. The fold's end says so, and so does a timer (the fold never ends in a
 * hidden tab, or for a row that came back mid-fold), so the page never waits on the animation alone.
 */
export const allLeft = <Item>(held: ReadonlyArray<Held<Item>>): ReadonlyArray<Held<Item>> =>
  held.reduce<ReadonlyArray<Held<Item>>>((rows, h) => (h.state.phase === "leaving" ? holdStep(rows, h.key, { type: "left" }) : rows), held)

/**
 * The held rows after the queue changed to `listed` (its keys): a row the queue stopped listing is
 * noted as dropped, and let go if it had already left; a row the queue lists again after dropping it
 * is a new packet, and is let go whatever its phase, so it shows. The same array when nothing changed.
 */
export const syncHeld = <Item>(held: ReadonlyArray<Held<Item>>, listed: ReadonlyArray<string>): ReadonlyArray<Held<Item>> => {
  const next = held.flatMap((h) => {
    if (listed.includes(h.key)) return h.dropped ? [] : [h]
    return h.state.phase === "gone" ? [] : h.dropped ? [h] : [{ ...h, dropped: true }]
  })
  return next.length === held.length && next.every((h, i) => h === held[i]) ? held : next
}

/**
 * The rows the page shows: the queue, with each pending or decided row still at its place though the
 * events took it off the queue, so it can say what was decided; and without the rows that are leaving
 * or gone while the queue still lists them (their events haven't arrived), so they can fold away. A
 * leaving row the queue lists again after dropping it is back, and shows.
 */
export const withHeld = <Item>(queue: ReadonlyArray<Item>, keyOf: (item: Item) => string, held: ReadonlyArray<Held<Item>>): Item[] => {
  const stays = (h: Held<Item>) => h.state.phase === "pending" || h.state.phase === "decided"
  const left = new Set(held.filter((h) => !stays(h) && !h.dropped).map((h) => h.key))
  const rows = queue.filter((item) => !left.has(keyOf(item)))
  for (const h of [...held].sort((a, b) => a.at - b.at)) {
    if (!stays(h) || rows.some((item) => keyOf(item) === h.key)) continue
    rows.splice(Math.min(h.at, rows.length), 0, h.item)
  }
  return rows
}

/**
 * The rows of `projectId` (null: all of them), in their order (CEL-188). The rows in `keep` (a decision
 * pending or just made) stay whatever their project, so a pick never takes away a row that is saying what
 * was decided: it folds away as usual.
 */
export const filterQueue = <Item extends { readonly task: { readonly key: string }; readonly project: { readonly id: string } }>(
  items: ReadonlyArray<Item>,
  projectId: string | null,
  keep: ReadonlySet<string> = new Set(),
): Item[] => (projectId === null ? [...items] : items.filter((item) => item.project.id === projectId || keep.has(item.task.key)))
