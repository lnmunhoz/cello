import { useSyncExternalStore } from "react"

// The decisions waiting in their undo window on the Review page (CEL-191). A decision is sent when its
// window ends, and exactly once: whichever of the timer, a tab coming back into view, or the page being
// left gets there first takes the entry, so the others find nothing. Undo takes it too, so nothing is
// sent. The timing lives here, not in a component, so a row that is collapsed or unmounted during its
// window still sends when it ends.

/** What a waiting decision does at either end of its window. */
export interface Waiting {
  /** The window ended, or the page was left: send the decision. */
  readonly send: () => void
  /** Undo (or a packet that was overtaken) cancelled it: nothing was sent. */
  readonly undone: () => void
}

/** The time source, so a test moves it by hand. */
export interface Clock {
  readonly now: () => number
  readonly set: (run: () => void, ms: number) => unknown
  readonly clear: (handle: unknown) => void
}

export const createDeferredDecisions = (clock: Clock) => {
  const waiting = new Map<string, { readonly dueAt: number; readonly handle: unknown; readonly entry: Waiting }>()
  const listeners = new Set<() => void>()
  /** The waiting keys as one string, so a store's snapshot is the same value until they change. */
  let keys = ""
  const changed = () => {
    keys = [...waiting.keys()].sort().join(" ")
    for (const listener of listeners) listener()
  }

  /** Takes the entry out and sends it; false when there's none (already sent or undone). */
  const fire = (key: string): boolean => {
    const w = waiting.get(key)
    if (!w) return false
    waiting.delete(key)
    clock.clear(w.handle)
    changed()
    w.entry.send()
    return true
  }

  return {
    /** Starts the window for `key`; a row already waiting keeps its own (false): a second click doesn't send twice. */
    start: (key: string, ms: number, entry: Waiting): boolean => {
      if (waiting.has(key)) return false
      waiting.set(key, { dueAt: clock.now() + ms, handle: clock.set(() => fire(key), ms), entry })
      changed()
      return true
    },
    /** Cancels the window: nothing is sent. False when it has already ended. */
    undo: (key: string): boolean => {
      const w = waiting.get(key)
      if (!w) return false
      waiting.delete(key)
      clock.clear(w.handle)
      changed()
      w.entry.undone()
      return true
    },
    fire,
    has: (key: string): boolean => waiting.has(key),
    /** For useSyncExternalStore: `keys` is the waiting task keys, space-separated, the same string until they change. */
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    keys: (): string => keys,
    /** Sends what's due: a hidden tab's timers run late, so the page calls this when it's seen again. */
    fireDue: (): void => {
      for (const [key, w] of [...waiting]) if (w.dueAt <= clock.now()) fire(key)
    },
    /** Sends everything waiting now: the page is being left, and Lucas did click Approve. */
    flushAll: (): void => {
      for (const key of [...waiting.keys()]) fire(key)
    },
  }
}

let turn: Promise<unknown> = Promise.resolve()

/**
 * Runs `send` after every send before it has answered. The command's setter hands back "the atom's next
 * settled result", so two decisions whose windows end together, sent side by side, could be told each
 * other's answer: a failure on one would read as the other's.
 */
export const inTurn = <T>(send: () => Promise<T>): Promise<T> => {
  const result = turn.then(send, send)
  turn = result.catch(() => undefined)
  return result
}

/** The page's one set of waiting decisions, on the real clock. */
export const deferredDecisions = createDeferredDecisions({ now: () => Date.now(), set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) })

/** The task keys whose decision waits in its undo window, re-rendering when one starts or ends. */
export const useWaitingDecisions = (): ReadonlyArray<string> => {
  const keys = useSyncExternalStore(deferredDecisions.subscribe, deferredDecisions.keys)
  return keys === "" ? [] : keys.split(" ")
}
