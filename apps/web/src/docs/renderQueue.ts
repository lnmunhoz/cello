// Runs diagram renders one at a time. Each gets at most `timeoutMs`, so one that never settles (a
// layout that hangs) fails on its own instead of blocking every diagram after it; a queued render
// whose diagram no longer wants it (unmounted, or the theme changed) is skipped.

/** A render that took longer than the queue allows. */
export class RenderTimeout extends Error {
  constructor(timeoutMs: number) {
    super(`it took longer than ${Math.round(timeoutMs / 1000)} s`)
    this.name = "RenderTimeout"
  }
}

/** A queued render dropped because nothing wanted it any more. */
export class RenderSkipped extends Error {
  constructor() {
    super("skipped")
    this.name = "RenderSkipped"
  }
}

const withTimeout = <A>(work: Promise<A>, timeoutMs: number): Promise<A> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RenderTimeout(timeoutMs)), timeoutMs)
  })
  return Promise.race([work, late]).finally(() => clearTimeout(timer))
}

export const renderQueue = (timeoutMs: number) => {
  let tail: Promise<unknown> = Promise.resolve()
  return <A>(task: () => Promise<A>, wanted: () => boolean = () => true): Promise<A> => {
    const next = tail.then(() => (wanted() ? withTimeout(task(), timeoutMs) : Promise.reject(new RenderSkipped())))
    tail = next.catch(() => undefined)
    return next
  }
}
