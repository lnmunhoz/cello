// Display → "Group In Progress by stage" (CEL-35): the In Progress column split into one lane per stage,
// in the stage list's order (new stages get a lane by themselves), then Working (no stage, an agent
// active on it: CEL-105), then the tasks without a stage. The
// ordering still holds inside each lane. A card dragged into another lane snaps back: the stage is the
// orchestrator's to set (`cello task stage`), not a drag's.
import type { Ordering } from "@cello/client/sync/ordering"
import { placement, placementAtEnd } from "@cello/client/sync/selectors"
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Task } from "@cello/contract/entities"
import { STAGE_IDS, type StageInfo, stageInfo, stageRank } from "@cello/contract/stages"
import { WORKING, WORKING_LANE, workingNow } from "../presence/model.ts"
import { type Drop, indexAmong, type Move } from "./moves.ts"

/** A task's lane in In Progress: its stage, else Working while an agent on it is active, else none (null). */
export const laneOf = (task: { readonly stage: string | null }, active: boolean): string | null =>
  task.stage ?? (active ? WORKING_LANE : null)

/** A task's lane on the board and in the list, read from its agent's presence right now. */
export const taskLane = (board: BoardState, task: Task, now: number): string | null => laneOf(task, workingNow(board, task, now))

/** A lane's place: the stages in their order, then Working, then no stage. */
const laneRank = (lane: string | null): number => (lane === WORKING_LANE ? STAGE_IDS.length : lane === null ? STAGE_IDS.length + 1 : stageRank(lane))

/** A lane's heading: the stage's, Working's, or null for no stage. */
export const laneInfo = (lane: string | null): StageInfo | null => (lane === WORKING_LANE ? WORKING : lane === null ? null : (stageInfo(lane) ?? null))

interface Staged {
  readonly id: string
  readonly position: string
  /** The task's lane (laneOf): its stage, Working, or null. */
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
    const rank = laneRank(task.stage)
    byRank.set(rank, [...(byRank.get(rank) ?? []), task])
  }
  return [...byRank.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, laneTasks]) => ({ stage: laneInfo(laneTasks[0]!.stage), tasks: laneTasks }))
}

/** Tasks with their lane key in `stage`, for stageLanes and laneDrop; `task` is the task itself. */
export const withLanes = <T extends { readonly id: string; readonly position: string }>(tasks: ReadonlyArray<T>, laneKeyOf: (task: T) => string | null) =>
  tasks.map((task) => ({ id: task.id, position: task.position, stage: laneKeyOf(task), task }))

/** A column's tasks (already in the ordering) lane by lane: what the board and the list draw. */
export const inLaneOrder = <T extends { readonly id: string; readonly position: string }>(tasks: ReadonlyArray<T>, laneKeyOf: (task: T) => string | null): T[] =>
  stageLanes(withLanes(tasks, laneKeyOf)).flatMap((lane) => lane.tasks.map((t) => t.task))

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
  // Among the lane's cards, shown or not (a filter may hide some, CEL-52).
  return { statusId: move.to, ...placement(lane, indexAmong(next, move, lane)) }
}
