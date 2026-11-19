// A Web Lock per task with a decision in its window (CEL-191), so tabs agree on who may send it. The tab
// whose window it is holds the lock until the decision is answered; a page that is gone loses it. A tab
// that loads and finds a recorded decision (useRecoverDecisions) waits for the lock: if another tab's window
// is running, it waits for that tab to send or undo; if the page that made the record is gone, it gets the
// lock at once, and is the only one to send. Without Web Locks nothing is held and nothing waits.

const lockName = (taskKey: string) => `cello:review-pending:${taskKey}`

/** Holds the task's lock until the returned `release` is called (or the page goes). */
export const holdWindowLock = (taskKey: string): (() => void) => {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks
  if (!locks) return () => {}
  let released = false
  let free = () => {}
  locks.request(lockName(taskKey), () => (released ? undefined : new Promise<void>((resolve) => (free = resolve)))).catch(() => {})
  return () => {
    released = true
    free()
  }
}

/** Runs `run` once the task's lock is free, holding it meanwhile. */
export const withPendingLock = <T>(taskKey: string, run: () => Promise<T>): Promise<T> => {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks
  return locks ? locks.request(lockName(taskKey), run) : run()
}
