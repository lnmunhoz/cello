// Optimistic patches over the synced state. Pure: the atom layer holds the list.
//
// A patch shows at once and is dropped when any of these happens:
// - the synced seq reaches the seq its RPC returned (or the RPC returned seq null: no change),
// - an event carrying its command id is applied,
// - its RPC fails (rollback),
// - a fresh snapshot replaces the state (a new epoch).
import type { BoardState } from "../sync/applyEvents.ts"
import type { Synced } from "../sync/follow.ts"

export type Patch = (state: BoardState) => BoardState

export interface Pending {
  readonly commandId: string
  /** The sync epoch the patch was made in. */
  readonly epoch: number
  readonly patch: Patch
  /** The seq the RPC returned: undefined while in flight, null for "no change". */
  readonly seq: number | null | undefined
}

export const pendingOf = (commandId: string, epoch: number, patch: Patch): Pending => ({
  commandId,
  epoch,
  patch,
  seq: undefined,
})

const isDone = (p: Pending, synced: Synced): boolean =>
  p.epoch !== synced.epoch ||
  synced.seen.has(p.commandId) ||
  p.seq === null ||
  (p.seq !== undefined && p.seq <= synced.state.seq)

export const begin = (pending: ReadonlyArray<Pending>, entry: Pending): ReadonlyArray<Pending> => [...pending, entry]

/** The RPC succeeded: keep the patch until the synced seq reaches `seq`. */
export const confirm = (pending: ReadonlyArray<Pending>, commandId: string, seq: number | null): ReadonlyArray<Pending> =>
  pending.map((p) => (p.commandId === commandId ? { ...p, seq } : p))

/** The RPC failed: drop the patch. */
export const rollback = (pending: ReadonlyArray<Pending>, commandId: string): ReadonlyArray<Pending> =>
  pending.filter((p) => p.commandId !== commandId)

/** Forget patches the synced state has caught up with. */
export const prune = (pending: ReadonlyArray<Pending>, synced: Synced): ReadonlyArray<Pending> =>
  pending.filter((p) => !isDone(p, synced))

/** What the screen shows: the synced state with the live patches applied in order. */
export const view = (synced: Synced, pending: ReadonlyArray<Pending>): BoardState => {
  let state = synced.state
  for (const p of pending) if (!isDone(p, synced)) state = p.patch(state)
  return state
}
