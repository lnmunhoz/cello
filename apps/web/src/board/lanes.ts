// Display → "Group In Progress by stage" (CEL-35): the In Progress column split into one lane per stage,
// in the stage list's order (new stages get a lane by themselves), then the tasks without a stage. The
// ordering still holds inside each lane. A card dragged into another lane snaps back: the stage is the
// orchestrator's to set (`cello task stage`), not a drag's.
import type { Ordering } from "@cello/client/sync/ordering"
import { placement, placementAtEnd } from "@cello/client/sync/selectors"
import { type StageInfo, stageInfo, stageRank } from "@cello/contract/stages"
import type { Drop, Move } from "./moves.ts"

interface Staged {
  readonly id: string
  readonly position: string
  readonly stage: string | null
}

export interface Lane<T extends Staged> {
  /** Null: the tasks with no stage. */
  readonly stage: StageInfo | null
  readonly tasks: ReadonlyArray<T>
}

/** A column's tasks (already in the ordering) as lanes, empty ones left out. */
export const stageLanes = <T extends Staged>(tasks: ReadonlyArray<T>): Lane<T>[] => {
  const byRank = new Map<number, T[]>()
  for (const task of tasks) {
    const rank = stageRank(task.stage)
    byRank.set(rank, [...(byRank.get(rank) ?? []), task])
  }
  return [...byRank.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, laneTasks]) => ({ stage: laneTasks[0]!.stage === null ? null : stageInfo(laneTasks[0]!.stage) ?? null, tasks: laneTasks }))
}

/**
 * Where lane headings go among the cards as they're drawn (`cards` may be mid-drag): above the first
 * card of each lane, with the lane's size. The card being dragged doesn't count, so its lane's heading
 * stays with the lane's other cards (and goes with it only when it's alone in its lane).
 */
export const laneHeadings = (
  cards: ReadonlyArray<string>,
  stageOf: (id: string) => string | null,
  movingKey: string | null,
): Map<number, { readonly stage: string | null; readonly count: number }> => {
  const counts = new Map<string | null, number>()
  for (const id of cards) counts.set(stageOf(id), (counts.get(stageOf(id)) ?? 0) + 1)
  const headings = new Map<number, { stage: string | null; count: number }>()
  const placed = new Set<string | null>()
  const place = (index: number) => {
    const stage = stageOf(cards[index]!)
    if (placed.has(stage)) return
    placed.add(stage)
    headings.set(index, { stage, count: counts.get(stage)! })
  }
  cards.forEach((id, index) => id !== movingKey && place(index))
  const moving = movingKey === null ? -1 : cards.indexOf(movingKey)
  if (moving !== -1) place(moving)
  return new Map([...headings].sort(([a], [b]) => a - b))
}

/**
 * What a drop on the laned column changes. `next` is the column's cards after the drop; `column` its
 * tasks in manual (position) order, without a card coming from elsewhere. A card belongs to its stage's
 * lane (one from another column has no stage yet). Dropped next to a card of its lane, it goes between
 * its lane neighbors (manual order only); dropped among another lane, it snaps back (null), or, coming
 * from another column, goes to the end of the no-stage lane.
 */
export const laneDrop = (
  move: Move,
  next: ReadonlyArray<string>,
  fromStatusId: string,
  ordering: Ordering,
  column: ReadonlyArray<Staged>,
): Drop | null => {
  const crossing = move.to !== fromStatusId
  // Cards not in the column itself (folded Needs input ones) belong to no lane: undefined matches none.
  const stageOf = (id: string): string | null | undefined => {
    const task = column.find((t) => t.id === id)
    return task ? task.stage : undefined
  }
  const own = crossing ? null : stageOf(move.key)
  const prev = next[move.index - 1]
  const after = next[move.index + 1]
  const inLane = (prev !== undefined && stageOf(prev) === own) || (after !== undefined && stageOf(after) === own)
  if (!crossing && (!inLane || ordering !== "manual")) return null
  const lane = column.filter((t) => t.id !== move.key && t.stage === own)
  if (crossing && (!inLane || ordering !== "manual")) return { statusId: move.to, ...placementAtEnd(column) }
  const laneIndex = next.slice(0, move.index).filter((id) => id !== move.key && stageOf(id) === own).length
  return { statusId: move.to, ...placement(lane, laneIndex) }
}
