// The animation queue behind agent cursors. Each agent session has its own lane: its steps play in
// order, one at a time, while different sessions play at once. A lane that falls behind speeds up,
// and above 8 waiting it skips to the end. The board's state never waits for any of this: the store
// applies every event at once, and the queue only times how the change is shown.
//
// Pure timing: what a step looks like is the Player's job (the DOM player in animator.ts, a fake in
// the tests), and time comes from a Scheduler, so tests run on a clock they move by hand.
import { PACING, phasesFor, speedScale, type Motion, type Phase, type StepKind } from "./pacing.ts"

export interface Scheduler {
  readonly now: () => number
  /** Runs `fn` after `ms`; the returned function cancels it. */
  readonly after: (ms: number, fn: () => void) => () => void
}

/** Real time, for the browser. */
export const realScheduler: Scheduler = {
  now: () => performance.now(),
  after: (ms, fn) => {
    const id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  },
}

export interface QueueStep {
  /** The agent session that made the change: one lane each. */
  readonly lane: string
  /** The task it's about. */
  readonly card: string
  readonly kind: StepKind
  /**
   * Whether the card's place on screen waits for this step: a move keeps showing the card in its old
   * slot, a create keeps the new card hidden, until the step plays. At most one step holds a card.
   */
  readonly holds: boolean
}

/** A step being played. */
export interface Playback {
  /** The lane's queue changed: play what's left at this share of full duration. */
  readonly setScale: (scale: number) => void
  /** Stop now. `done` is not called; the queue drops the step itself. */
  readonly cancel: () => void
}

export interface Player<S extends QueueStep> {
  /** Plays `phases` at `scale` of their full duration, and calls `done` once when they end. */
  readonly play: (step: S, phases: ReadonlyArray<Phase>, scale: number, done: () => void) => Playback
  /** Ends a step without playing (the rest of) it: what it held goes, the card shows at its real place. */
  readonly drop: (step: S) => void
  /** A newer move of the same card takes over what an older, queued one held on screen. */
  readonly handOver: (from: S, to: S) => void
  /** The lane went quiet: its cursor fades. */
  readonly idle: (lane: string) => void
  /** The lane skipped to the end; it made `count` changes in this run. */
  readonly skipped: (lane: string, count: number) => void
}

export interface QueueOptions {
  /** Read as each step starts: `reduced` for prefers-reduced-motion or while Lucas drags. */
  readonly motion?: () => Motion
}

/** What `push` did with a step. */
export type Pushed = "queued" | "merged" | "dropped" | "skipped"

interface Entry<S> {
  readonly step: S
  state: "queued" | "playing"
  playback?: Playback
  /** The scale it plays at now. */
  scale?: number
}

interface Lane<S> {
  readonly id: string
  queue: Array<Entry<S>>
  current: Entry<S> | null
  /** Changes since the lane last went quiet, for "made 23 changes". */
  runCount: number
  skipping: boolean
  /** The gap after a step, the linger before the cursor fades, or the quiet that ends a skip. */
  timer: (() => void) | null
  timerKind: "gap" | "idle" | "quiet" | null
}

export class CursorQueue<S extends QueueStep> {
  private readonly lanes = new Map<string, Lane<S>>()
  /** The one entry holding each card. */
  private readonly byCard = new Map<string, Entry<S>>()

  constructor(
    private readonly player: Player<S>,
    private readonly scheduler: Scheduler,
    private readonly options: QueueOptions = {},
  ) {}

  /** Adds a step to its session's lane. The board has already applied the change. */
  push(step: S): Pushed {
    let merged = false
    if (step.holds) {
      const existing = this.byCard.get(step.card)
      if (existing) {
        // A flight in progress aims at the card's slot as it is now, so it carries the card on; a
        // create still waiting shows the card wherever it is by the time it plays. Either way the
        // newer step has nothing to add.
        if (existing.state === "playing" || existing.step.kind === "create") {
          this.player.drop(step)
          return "dropped"
        }
        // Newest wins: the older, queued move gives up its place in its lane and hands what it holds
        // on screen (the card still shown in its old slot) to this one.
        const owner = this.laneOf(existing.step.lane)
        owner.queue = owner.queue.filter((e) => e !== existing)
        this.byCard.delete(step.card)
        this.player.handOver(existing.step, step)
        this.retime(owner)
        if (owner !== this.laneOf(step.lane)) this.settle(owner)
        merged = true
      }
    }

    const lane = this.laneOf(step.lane)
    lane.runCount++
    if (lane.skipping) {
      this.player.drop(step)
      this.player.skipped(lane.id, lane.runCount)
      this.wait(lane, "quiet", PACING.quietMs)
      return "skipped"
    }
    if (lane.timerKind === "idle") this.stopTimer(lane)

    const entry: Entry<S> = { step, state: "queued" }
    lane.queue.push(entry)
    if (step.holds) this.byCard.set(step.card, entry)
    if (this.waiting(lane.id) > PACING.skipAt) {
      this.skip(lane)
      return "skipped"
    }
    this.retime(lane)
    this.pump(lane)
    return merged ? "merged" : "queued"
  }

  /** Whether a step holds this card's place on screen (a hole in its old slot, or a hidden new card). */
  holding(card: string): boolean {
    return this.byCard.has(card)
  }

  /** Steps waiting in a lane, counting the one playing. */
  waiting(lane: string): number {
    const l = this.lanes.get(lane)
    return l ? l.queue.length + (l.current ? 1 : 0) : 0
  }

  /** Lucas grabbed this card: its step stops at once and the card shows at its real place. */
  release(card: string): void {
    const entry = this.byCard.get(card)
    if (!entry) return
    this.byCard.delete(card)
    const lane = this.laneOf(entry.step.lane)
    if (lane.current === entry) {
      entry.playback?.cancel()
      lane.current = null
      this.player.drop(entry.step)
      this.stopTimer(lane)
      this.retime(lane)
      this.pump(lane)
    } else {
      lane.queue = lane.queue.filter((e) => e !== entry)
      this.player.drop(entry.step)
      this.retime(lane)
    }
  }

  /** Lucas started dragging: every step that holds a card lands now, so nothing moves under his hand. */
  releaseAll(): void {
    for (const card of [...this.byCard.keys()]) this.release(card)
  }

  /** Drops everything (the board closed, or cursors were turned off). */
  clear(): void {
    for (const lane of this.lanes.values()) {
      this.stopTimer(lane)
      if (lane.current) {
        lane.current.playback?.cancel()
        this.player.drop(lane.current.step)
      }
      for (const e of lane.queue) this.player.drop(e.step)
    }
    this.lanes.clear()
    this.byCard.clear()
  }

  private laneOf(id: string): Lane<S> {
    let lane = this.lanes.get(id)
    if (!lane) {
      lane = { id, queue: [], current: null, runCount: 0, skipping: false, timer: null, timerKind: null }
      this.lanes.set(id, lane)
    }
    return lane
  }

  private scale(lane: Lane<S>): number {
    return speedScale(this.waiting(lane.id))
  }

  /** The queue changed: the step in flight speeds up (or slows down) right away. */
  private retime(lane: Lane<S>) {
    const current = lane.current
    if (!current?.playback) return
    const scale = this.scale(lane)
    if (current.scale === scale) return
    current.scale = scale
    current.playback.setScale(scale)
  }

  private stopTimer(lane: Lane<S>) {
    lane.timer?.()
    lane.timer = null
    lane.timerKind = null
  }

  private wait(lane: Lane<S>, kind: "gap" | "idle" | "quiet", ms: number) {
    this.stopTimer(lane)
    lane.timerKind = kind
    lane.timer = this.scheduler.after(ms, () => {
      lane.timer = null
      lane.timerKind = null
      if (kind === "gap") return this.pump(lane)
      // Idle after the linger, or the quiet that ends a skip: the run is over.
      lane.skipping = false
      lane.runCount = 0
      this.player.idle(lane.id)
    })
  }

  /** A lane that lost its work to another: if nothing is left, its cursor lingers, then fades. */
  private settle(lane: Lane<S>) {
    if (!lane.current && lane.queue.length === 0 && lane.timerKind !== "gap") this.wait(lane, "idle", PACING.cursorLinger)
  }

  private pump(lane: Lane<S>) {
    if (lane.current || lane.skipping || lane.timerKind === "gap") return
    const entry = lane.queue.shift()
    if (!entry) {
      this.wait(lane, "idle", PACING.cursorLinger)
      return
    }
    this.stopTimer(lane)
    lane.current = entry
    entry.state = "playing"
    const phases = phasesFor(entry.step.kind, this.options.motion?.() ?? "full")
    let finished = false
    entry.scale = this.scale(lane)
    entry.playback = this.player.play(entry.step, phases, entry.scale, () => {
      if (finished || lane.current !== entry) return
      finished = true
      if (this.byCard.get(entry.step.card) === entry) this.byCard.delete(entry.step.card)
      lane.current = null
      this.wait(lane, "gap", PACING.gap * this.scale(lane))
    })
  }

  /** Too far behind: everything waiting lands now, and the lane says how many changes it made. */
  private skip(lane: Lane<S>) {
    lane.skipping = true
    if (lane.current) {
      lane.current.playback?.cancel()
      this.forget(lane.current)
      this.player.drop(lane.current.step)
      lane.current = null
    }
    for (const e of lane.queue) {
      this.forget(e)
      this.player.drop(e.step)
    }
    lane.queue = []
    this.player.skipped(lane.id, lane.runCount)
    this.wait(lane, "quiet", PACING.quietMs)
  }

  private forget(entry: Entry<S>) {
    if (this.byCard.get(entry.step.card) === entry) this.byCard.delete(entry.step.card)
  }
}
