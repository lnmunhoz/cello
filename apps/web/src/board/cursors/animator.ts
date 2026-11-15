// Agent cursors on the board: the DOM player behind the queue. When an agent session changes the
// board, a cursor in that session's colour flies to the card and performs the change.
//
// Rules (from the M0 spike, docs/internals/spike-board-ui.md):
// - Record, then apply. The store applies every event at once; this layer only reads the DOM before
//   React renders the change (to see where the card was) and draws on top. If it throws, the change
//   has still landed.
// - While a move waits, the card shows as a static copy in its old slot (a hole, rendered by React so
//   it reflows) and is hidden at its new one. When it plays: the cursor glides to the copy, a ghost
//   replaces it and lifts, the old slot closes, the ghost flies to the new slot, and lands.
// - Lucas wins: grabbing a card stops its step at once; while he drags, nothing holds a card's place
//   and new steps only highlight, so nothing moves under his hand.
// - Nothing runs on an idle board: every animation starts from an event and ends.
import type { Synced } from "@cello/client/sync/follow"
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { AgentSession } from "@cello/contract/entities"
import { AGENT_COLORS, colorFromSeed } from "@cello/shared/color"
import { animate, type AnimationPlaybackControls } from "motion"
import { useSyncExternalStore } from "react"
import { cssString, stylesFor } from "./css.ts"
import { closeHole, type Hole } from "./holes.ts"
import { BLINK, BLINK_DELAY, BLINK_MS, cursorMark, LABEL_OFFSET, SQUASH, SQUASH_MS } from "./mark.ts"
import { glideMs, PACING, type Phase } from "./pacing.ts"
import { CursorQueue, realScheduler, type Playback, type Player, type QueueStep } from "./queue.ts"
import { changeOf, type Change } from "./steps.ts"

export interface CursorStep extends QueueStep {
  readonly id: number
  readonly actorId: string
  readonly note: string | null
}

// ---------------------------------------------------------------------------
// What React reads: the holes, a new snapshot only when one opens or closes, never per frame. A hole
// opens with the event that moved its card, so React draws both in one render; closing it is the one
// extra render a move costs. Which cards wait (hidden at their new slot, or keeping the space a ghost
// flies to) and which holes a ghost took over are CSS rules in one style element instead, so a 200-card
// board doesn't re-render for them.

/** A card hidden at its new slot (`queued`), or keeping the space a ghost flies to (`flying`). */
export type Pending = "queued" | "flying"

export interface Visual {
  readonly holes: ReadonlyArray<Hole>
}

const EMPTY: Visual = { holes: [] }

// ---------------------------------------------------------------------------

/** Where a ghost is drawn: its rectangle, and how lifted it looks. */
interface Geometry {
  x: number
  y: number
  w: number
  h: number
  scale: number
  rot: number
  lift: number
}

/** What a step holds on screen. Handed to a newer step of the same card when they merge. */
interface Held {
  holeId: number | null
  ghost: HTMLElement | null
  g: Geometry
}

interface Run {
  scale: number
  cancelled: boolean
  controls: AnimationPlaybackControls | null
  stop: (() => void) | null
  /** Things to undo if the step stops halfway: inline styles, a bubble. */
  cleanups: Array<() => void>
}

interface Cursor {
  el: HTMLElement
  x: number
  y: number
  fade: Animation | null
  /** A blink waiting to play while the cursor lingers; a next step cancels it. */
  blink: Animation | null
  /** The pill's width, measured once per label (0: not yet). */
  labelWidth: number
}

/** Asks the server who a session is (task.get lists the sessions a task's history names). */
export type Lookup = (taskKey: string) => Promise<{ readonly sessions: ReadonlyArray<AgentSession> }>

export interface Attachment {
  readonly projectId: string
  readonly enabled: boolean
  readonly reduced: boolean
  readonly lookup: Lookup
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** Attributes a copy of a card must not carry: it's not a card (tests, drag and drop and React ignore it). */
const COPY_STRIPS = [
  "data-card-id",
  "data-task-key",
  "data-agent-hole",
  "data-agent-hole-card",
  "data-moving",
  "data-dragging",
  "aria-current",
  "aria-roledescription",
  "tabindex",
  "role",
  "id",
  "style",
]

export class Animator implements Player<CursorStep> {
  readonly queue = new CursorQueue<CursorStep>(this, realScheduler, { motion: () => this.motion() })

  private visual: Visual = EMPTY
  private readonly pending = new Map<string, Pending>()
  private holes: Hole[] = []
  private readonly listeners = new Set<() => void>()
  private readonly held = new Map<CursorStep, Held>()
  private readonly runs = new Map<CursorStep, Run>()
  private readonly cursors = new Map<string, Cursor>()
  /** Session id → "Claude Code · 2fd0505c", once the server said who it is. */
  private readonly labels = new Map<string, string>()
  private readonly asked = new Set<string>()
  /** The step that holds each card's place (hidden at its new slot, maybe a hole in its old one). */
  private readonly owner = new Map<string, CursorStep>()
  private readonly laneActors = new Map<string, string>()
  private readonly colors = new Map<string, string>()
  private nextId = 1
  private attachment: Attachment | null = null
  private last: Synced | null = null
  private reduced = false
  private dragging = false
  /**
   * Steps dropped while Lucas drags: their holes keep their space and their waiting cards stay hidden
   * until he lets go, so nothing moves under his hand. Card → the step that held it, and its hole.
   */
  private readonly deferred = new Map<string, { step: CursorStep; holeId: number | null }>()

  // ---- React ------------------------------------------------------------

  readonly subscribe = (onChange: () => void) => {
    this.listeners.add(onChange)
    return () => {
      this.listeners.delete(onChange)
    }
  }

  readonly snapshot = (): Visual => this.visual

  private change(f: (pending: Map<string, Pending>, holes: Hole[]) => void) {
    const before = this.visual.holes
    const holes = [...this.holes]
    f(this.pending, holes)
    this.holes = holes
    this.paint()
    if (holes.length === before.length && holes.every((h, i) => h.id === before[i]?.id)) return
    this.visual = { holes }
    for (const l of this.listeners) l()
  }

  /** Writes the waiting cards and taken-over holes as CSS rules. */
  private paint() {
    const text = stylesFor(this.pending, this.holes)
    let el = document.getElementById("agent-cursor-styles")
    if (!el) {
      if (text === "") return
      el = document.createElement("style")
      el.id = "agent-cursor-styles"
      document.head.append(el)
    }
    if (el.textContent !== text) el.textContent = text
  }

  // ---- Wiring -----------------------------------------------------------

  /** The board on screen, and how it wants cursors shown. */
  attach(next: Attachment) {
    const was = this.attachment
    this.attachment = next
    this.reduced = next.reduced
    if (was && (!next.enabled || was.projectId !== next.projectId)) this.reset()
  }

  /** The board closed. */
  detach() {
    this.attachment = null
    this.reset()
  }

  /** How steps play now: `reduced` (a highlight) under prefers-reduced-motion or while Lucas drags. */
  motion(): "full" | "reduced" {
    return this.reduced || this.dragging ? "reduced" : "full"
  }

  /** Every change of the synced state; runs before React renders it, so the DOM still shows the old board. */
  receive(synced: Synced) {
    const prev = this.last
    this.last = synced
    const at = this.attachment
    if (!at || !at.enabled || !prev) return
    if (prev.epoch !== synced.epoch) return this.reset()
    for (const e of synced.batch) {
      try {
        const c = changeOf(e, at.projectId, (id) => prev.state.tasks[id])
        if (c) this.enqueue(c, synced.state)
      } catch (err) {
        console.error(err)
      }
    }
  }

  /** Lucas pressed on a card (or its copy): its step stops and the card shows where it really is. */
  grab(card: string) {
    this.queue.release(card)
  }

  /** Lucas picked up a card to drag it, or dropped it. */
  setDragging(on: boolean) {
    if (on === this.dragging) return
    this.dragging = on
    if (on) return this.queue.releaseAll()
    // He let go: what waited for him lands now.
    const deferred = [...this.deferred.values()]
    this.deferred.clear()
    for (const { step, holeId } of deferred) this.release(step, holeId)
  }

  /** Drops everything on screen. */
  reset() {
    this.dragging = false
    this.deferred.clear()
    this.queue.clear()
    for (const c of this.cursors.values()) {
      stopBlink(c)
      c.el.remove()
    }
    this.cursors.clear()
    for (const run of this.runs.values()) for (const undo of run.cleanups.splice(0)) undo()
    this.runs.clear()
    for (const h of this.held.values()) h.ghost?.remove()
    this.held.clear()
    this.owner.clear()
    document.getElementById("agent-layer")?.replaceChildren()
    this.pending.clear()
    this.holes = []
    this.paint()
    if (this.visual.holes.length > 0) {
      this.visual = EMPTY
      for (const l of this.listeners) l()
    }
  }

  private enqueue(c: Change, state: BoardState) {
    this.laneActors.set(c.lane, c.actorId)
    this.askWho(c.lane, state.tasks[c.card]?.key)
    const full = !this.reduced && !this.dragging
    const merging = this.queue.holding(c.card)
    let holds = false
    let recorded: { held: Held; hole: Hole } | null = null
    if (full && c.kind === "move") {
      // A card already held merges into the step that holds it (the queue decides how); otherwise its
      // old slot is recorded now, before React shows the move.
      recorded = merging ? null : this.record(c.card)
      holds = merging || recorded !== null
    } else if (full && c.kind === "create") {
      holds = !merging
    }
    const step: CursorStep = { id: this.nextId++, lane: c.lane, card: c.card, kind: c.kind, holds, actorId: c.actorId, note: c.note }
    if (holds && !merging) {
      this.owner.set(c.card, step)
      if (recorded) this.held.set(step, recorded.held)
      this.change((pending, holes) => {
        pending.set(c.card, "queued")
        if (recorded) holes.push(recorded.hole)
      })
    }
    this.queue.push(step)
  }

  /** Before the move renders: where the card is now, kept as a hole in its old slot. */
  private record(card: string): { held: Held; hole: Hole } | null {
    const el = cardEl(card)
    if (!el || el.getClientRects().length === 0) return null
    const column = el.closest<HTMLElement>("[data-status-id]")
    if (!column) return null
    const r = el.getBoundingClientRect()
    if (!insideBoard(r)) return null
    let prev = el.previousElementSibling as HTMLElement | null
    while (prev && !keyOf(prev)) prev = prev.previousElementSibling as HTMLElement | null
    const siblings = [...(el.parentElement?.children ?? [])].filter((x) => keyOf(x as HTMLElement))
    const id = this.nextId++
    return {
      hole: { id, card, statusId: column.dataset.statusId!, after: prev ? keyOf(prev) : null, index: siblings.indexOf(el), hidden: false },
      held: { holeId: id, ghost: null, g: { x: r.left, y: r.top, w: r.width, h: r.height, scale: 1, rot: 0, lift: 0 } },
    }
  }

  // ---- Who: "Claude Code · 2fd0505c" -------------------------------------

  private nameOf(lane: string, actorId: string): string {
    return this.labels.get(lane) ?? this.last?.state.actors[actorId]?.name ?? "Agent"
  }

  private askWho(lane: string, taskKey: string | undefined) {
    if (this.asked.has(lane) || !taskKey || !this.attachment) return
    this.asked.add(lane)
    this.attachment
      .lookup(taskKey)
      .then((detail) => {
        const session = detail.sessions.find((s) => s.id === lane)
        if (!session) return void this.asked.delete(lane)
        const actor = this.last?.state.actors[session.actorId]?.name ?? session.clientName
        const short = (session.externalId ?? session.id).slice(0, 8)
        this.labels.set(lane, `${actor} · ${short}`)
        const label = this.cursors.get(lane)?.el.querySelector("span")
        if (label) label.textContent = this.labels.get(lane)!
        const cursor = this.cursors.get(lane)
        if (cursor) cursor.labelWidth = 0
      })
      .catch(() => this.asked.delete(lane))
  }

  /**
   * A session's colour: picked from the palette by its id, so it's the same after a reload, unless a
   * session on screen already has it, then the next free one, so two cursors never look alike.
   */
  private colorOf(lane: string): string {
    const known = this.colors.get(lane)
    if (known) return known
    const taken = new Set([...this.cursors.keys()].map((l) => this.colors.get(l)))
    const start = AGENT_COLORS.indexOf(colorFromSeed(lane) as (typeof AGENT_COLORS)[number])
    const free = AGENT_COLORS.map((_, i) => AGENT_COLORS[(start + i) % AGENT_COLORS.length]!).find((c) => !taken.has(c))
    const color = free ?? colorFromSeed(lane)
    this.colors.set(lane, color)
    return color
  }

  // ---- Player: the queue calls these ----------------------------------------

  play(step: CursorStep, phases: ReadonlyArray<Phase>, scale: number, done: () => void): Playback {
    const run: Run = { scale, cancelled: false, controls: null, stop: null, cleanups: [] }
    this.runs.set(step, run)
    const finish = () => {
      if (run.cancelled) return
      this.runs.delete(step)
      for (const undo of run.cleanups.splice(0)) undo()
      this.land(step)
      this.blinkLater(step.lane)
      done()
    }
    this.perform(step, phases, run).then(finish, (err: unknown) => {
      console.error(err)
      finish()
    })
    return {
      setScale: (next) => {
        run.scale = next
        if (run.controls) run.controls.speed = 1 / next
      },
      cancel: () => {
        run.cancelled = true
        run.stop?.()
        this.runs.delete(step)
        for (const undo of run.cleanups.splice(0)) undo()
      },
    }
  }

  drop(step: CursorStep) {
    const run = this.runs.get(step)
    if (run) {
      run.cancelled = true
      run.stop?.()
      for (const undo of run.cleanups.splice(0)) undo()
      this.runs.delete(step)
    }
    this.land(step, false)
  }

  handOver(from: CursorStep, to: CursorStep) {
    const held = this.held.get(from)
    this.held.delete(from)
    if (held) this.held.set(to, held)
    if (this.owner.get(from.card) === from) this.owner.set(to.card, to)
  }

  idle(lane: string) {
    const cursor = this.cursors.get(lane)
    if (!cursor) return
    stopBlink(cursor)
    cursor.fade = cursor.el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: PACING.cursorFade, easing: "ease-in", fill: "forwards" })
    cursor.fade.onfinish = () => {
      if (this.cursors.get(lane) !== cursor || cursor.fade === null) return
      cursor.el.remove()
      this.cursors.delete(lane)
    }
  }

  skipped(lane: string, count: number) {
    const cursor = this.cursors.get(lane)
    if (cursor) stopBlink(cursor)
    cursor?.el.remove()
    this.cursors.delete(lane)
    const name = this.nameOf(lane, this.laneActors.get(lane) ?? "").split(" · ")[0]
    this.notice(lane, `${name} made ${count} changes`)
  }

  /**
   * "Claude Code made 23 changes", at the foot of the board in the session's colour, updated in place
   * while the burst lasts, then gone. Its own small notice rather than the app's toast: a toast showing
   * while the desktop app enters full screen left the board view at its old size under Xvfb.
   */
  private notice(lane: string, text: string) {
    let box = document.getElementById("agent-notices")
    if (!box) {
      box = document.createElement("div")
      box.id = "agent-notices"
      box.setAttribute("role", "status")
      document.body.append(box)
    }
    let el = box.querySelector<HTMLElement>(`[data-agent-notice="${esc(lane)}"]`)
    if (!el) {
      el = document.createElement("div")
      el.className = "agent-notice"
      el.dataset.agentNotice = lane
      el.style.setProperty("--agent", this.colorOf(lane))
      box.append(el)
    }
    el.textContent = text
    const b = boardRect()
    if (b) box.style.left = `${b.left + b.width / 2}px`
    for (const a of el.getAnimations()) a.cancel()
    const shown = el
    el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.06 }, { opacity: 1, offset: 0.92 }, { opacity: 0 }], { duration: PACING.toastMs }).onfinish = () =>
      shown.remove()
  }

  // ---- Drawing ----------------------------------------------------------------

  /** Ends a step: the ghost and the hole go, the real card shows at its slot, and (if it played) a ring trails. */
  private land(step: CursorStep, played = true) {
    const held = this.held.get(step)
    this.held.delete(step)
    held?.ghost?.remove()
    this.release(step, held?.holeId ?? null)
    if (played) {
      const el = cardEl(step.card)
      if (el) trail(el, this.colorOf(step.lane))
      if (step.kind === "move" && step.note && el) this.trailBubble(step, el)
    }
  }

  /**
   * Lucas is dragging: a flying card shows in the space it already holds and its hole stays as an empty
   * space; a waiting card stays as he saw it (its copy in the old slot). Both land when he lets go.
   */
  private defer(step: CursorStep, holeId: number | null) {
    // A step can be deferred twice (it let go of its hole, then was dropped): keep the hole it named.
    this.deferred.set(step.card, { step, holeId: holeId ?? this.deferred.get(step.card)?.holeId ?? null })
    if (this.pending.get(step.card) !== "flying") return
    this.change((pending, holes) => {
      pending.delete(step.card)
      const i = holes.findIndex((h) => h.id === holeId)
      if (i !== -1) holes[i] = { ...holes[i]!, hidden: true }
    })
  }

  /** The card shows at its real slot again (if this step held it), and the step's hole closes. */
  private release(step: CursorStep, holeId: number | null) {
    if (this.dragging && this.owner.get(step.card) === step) return this.defer(step, holeId)
    const owns = this.owner.get(step.card) === step
    if (owns) this.owner.delete(step.card)
    const unhide = owns && this.pending.has(step.card)
    const close = holeId !== null && this.holes.some((h) => h.id === holeId)
    if (!unhide && !close) return
    this.change((pending, holes) => {
      if (unhide) pending.delete(step.card)
      if (close) holes.splice(0, holes.length, ...closeHole(holes, holeId!))
    })
  }

  private layer(): HTMLElement {
    let el = document.getElementById("agent-layer")
    if (!el) {
      el = document.createElement("div")
      el.id = "agent-layer"
      el.setAttribute("aria-hidden", "true")
      document.body.append(el)
    }
    return el
  }

  private cursorFor(step: CursorStep): { cursor: Cursor; fresh: boolean } {
    const existing = this.cursors.get(step.lane)
    if (existing) {
      stopBlink(existing)
      if (existing.fade) {
        const fade = existing.fade
        existing.fade = null
        fade.cancel()
      }
      return { cursor: existing, fresh: false }
    }
    const el = document.createElement("div")
    el.className = "agent-cursor"
    el.dataset.agentCursor = step.lane
    el.style.setProperty("--agent", this.colorOf(step.lane))
    el.innerHTML = `${cursorMark()}<span></span>`
    el.querySelector("span")!.textContent = this.nameOf(step.lane, step.actorId)
    el.style.opacity = "0"
    this.layer().append(el)
    const cursor: Cursor = { el, x: 0, y: 0, fade: null, blink: null, labelWidth: 0 }
    this.cursors.set(step.lane, cursor)
    return { cursor, fresh: true }
  }

  private moveCursor(cursor: Cursor, x: number, y: number) {
    const p = clampToBoard(x, y)
    cursor.x = p.x
    cursor.y = p.y
    cursor.el.style.transform = `translate(${p.x}px, ${p.y}px)`
    // Near the board's right edge the pill goes to the mark's left, so it stays on the board.
    if (cursor.labelWidth === 0) cursor.labelWidth = cursor.el.querySelector("span")?.offsetWidth ?? 0
    const right = boardRect()?.right ?? innerWidth
    cursor.el.toggleAttribute("data-flip", p.x + LABEL_OFFSET + cursor.labelWidth > right - 4)
  }

  /** A click (landing a card, pressing a column's +): the mark squashes about its tip. Not under reduced motion. */
  private squash(cursor: Cursor, run: Run) {
    if (this.reduced) return
    cursor.el.querySelector("[data-agent-mark]")?.animate(SQUASH, { duration: SQUASH_MS * run.scale, easing: "ease-out" })
  }

  /** A step ended: if the session has nothing next, its cursor blinks once while it lingers. Not under reduced motion. */
  private blinkLater(lane: string) {
    const cursor = this.cursors.get(lane)
    const eyes = cursor?.el.querySelector("[data-agent-eyes]")
    if (!cursor || !eyes || this.reduced) return
    stopBlink(cursor)
    const blink = eyes.animate(BLINK, { duration: BLINK_MS, delay: BLINK_DELAY, easing: "ease-in-out" })
    cursor.blink = blink
    blink.onfinish = () => {
      if (cursor.blink === blink) cursor.blink = null
    }
  }

  /** One timed step on Motion's frame loop, at the run's speed. Resolves false if the run stopped. */
  private phase(run: Run, ms: number, frame: (t: number) => void): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      if (run.cancelled) return resolve(false)
      let settled = false
      const settle = (ok: boolean) => {
        if (settled) return
        settled = true
        run.controls = null
        run.stop = null
        resolve(ok)
      }
      const controls = animate(0, 1, {
        duration: Math.max(ms, 1) / 1000,
        ease: "linear",
        onUpdate: (t) => {
          if (!run.cancelled) frame(t)
        },
        onComplete: () => {
          if (!run.cancelled) frame(1)
          settle(!run.cancelled)
        },
      })
      controls.speed = 1 / run.scale
      run.controls = controls
      run.stop = () => {
        controls.stop()
        settle(false)
      }
    })
  }

  /** Where the step's card is shown now: the card, or its copy in the old slot while it waits. */
  private targetOf(step: CursorStep): HTMLElement | null {
    const held = this.held.get(step)
    if (held?.ghost) return held.ghost
    const hole = held?.holeId != null ? holeEl(held.holeId) : null
    if (hole) return hole
    if (this.pending.get(step.card) === "queued") return holeOfCard(step.card)
    return cardEl(step.card)
  }

  private async perform(step: CursorStep, phases: ReadonlyArray<Phase>, run: Run): Promise<void> {
    const color = this.colorOf(step.lane)
    const { cursor, fresh } = this.cursorFor(step)
    const grab = (r: { left: number; top: number; width: number; height: number }) => ({ x: r.left + r.width * 0.3, y: r.top + r.height * 0.55 })

    for (const p of phases) {
      if (run.cancelled) return
      switch (p.name) {
        case "highlight": {
          // Reduced motion (or Lucas dragging): no flight. The cursor shows at the card, which gets a ring.
          const held = this.held.get(step)
          if (held) {
            this.held.delete(step)
            held.ghost?.remove()
          }
          this.release(step, held?.holeId ?? null)
          // The step may start the moment the event arrives, before React has drawn the change: wait a
          // frame, so the cursor shows at the card's new place, not its old one.
          await nextFrame()
          if (run.cancelled) return
          const el = this.targetOf(step)
          if (el) trail(el, color)
          await this.phase(run, p.ms, (t) => {
            const target = this.targetOf(step)
            if (target) {
              const at = grab(target.getBoundingClientRect())
              this.moveCursor(cursor, at.x, at.y)
            }
            cursor.el.style.opacity = String(target ? Math.min(1, t * 4) : 0)
          })
          break
        }
        case "glide": {
          const aim = (): { x: number; y: number } | null => {
            if (step.kind === "create") {
              const plus = plusOf(this.last?.state.tasks[step.card]?.statusId)
              if (plus) return grab(plus.getBoundingClientRect())
            }
            const held = this.held.get(step)
            const el = this.targetOf(step)
            if (el) return grab(el.getBoundingClientRect())
            if (held) return grab({ left: held.g.x, top: held.g.y, width: held.g.w, height: held.g.h })
            return null
          }
          const start = aim()
          // The card isn't on this board (a folded column): nothing to point at.
          if (!start) break
          if (fresh) this.moveCursor(cursor, start.x - 70, start.y + 50)
          const from = { x: cursor.x, y: cursor.y }
          const opacity = Number(cursor.el.style.opacity || 1)
          const ms = glideMs(Math.hypot(start.x - from.x, start.y - from.y), p.ms)
          await this.phase(run, ms, (t) => {
            const to = aim() ?? start
            const k = easeOut(t)
            this.moveCursor(cursor, lerp(from.x, to.x, k), lerp(from.y, to.y, k))
            if (opacity < 1) cursor.el.style.opacity = String(lerp(opacity, 1, Math.min(1, t * 2)))
          })
          break
        }
        case "lift": {
          const held = this.held.get(step)
          if (!held) {
            // A move the board couldn't record (the card wasn't on screen): the card just gets a ring.
            const el = cardEl(step.card)
            if (el) trail(el, color)
            break
          }
          this.takeOff(step, held)
          const g0 = { ...held.g }
          const dx = held.g.w * 0.3
          const dy = held.g.h * 0.55
          await this.phase(run, p.ms, (t) => {
            const k = easeOut(t)
            held.g.scale = lerp(g0.scale, 1.04, k)
            held.g.rot = lerp(g0.rot, -1.5, k)
            held.g.lift = lerp(g0.lift, 1, k)
            drawGhost(held)
            this.moveCursor(cursor, held.g.x + dx, held.g.y + dy)
          })
          break
        }
        case "travel": {
          const held = this.held.get(step)
          if (!held) break
          // The old slot closes while the ghost flies to the space the card holds in its new one.
          if (held.holeId != null) {
            const id = held.holeId
            held.holeId = null
            this.change((_, holes) => holes.splice(0, holes.length, ...closeHole(holes, id)))
          }
          const from = { x: held.g.x, y: held.g.y }
          const dx = held.g.w * 0.3
          const dy = held.g.h * 0.55
          await this.phase(run, p.ms, (t) => {
            const k = easeInOut(t)
            const target = cardEl(step.card)
            const r = target && target.getClientRects().length > 0 ? target.getBoundingClientRect() : null
            if (r) {
              held.g.x = lerp(from.x, r.left, k)
              held.g.y = lerp(from.y, r.top, k)
            } else if (held.ghost) {
              // Its new column isn't on screen (folded): the copy fades where it is.
              held.ghost.style.opacity = String(1 - k)
            }
            drawGhost(held)
            this.moveCursor(cursor, held.g.x + dx, held.g.y + dy)
          })
          break
        }
        case "land": {
          const held = this.held.get(step)
          if (!held) break
          this.squash(cursor, run)
          const g1 = { ...held.g }
          const dx = held.g.w * 0.3
          const dy = held.g.h * 0.55
          await this.phase(run, p.ms, (t) => {
            const k = easeOut(t)
            const target = cardEl(step.card)
            if (target && target.getClientRects().length > 0) {
              const r = target.getBoundingClientRect()
              held.g.x = r.left
              held.g.y = r.top
            }
            held.g.scale = lerp(g1.scale, 1, k)
            held.g.rot = lerp(g1.rot, 0, k)
            held.g.lift = lerp(g1.lift, 0, k)
            drawGhost(held)
            this.moveCursor(cursor, held.g.x + dx, held.g.y + dy)
          })
          break
        }
        case "appear": {
          // The cursor clicks the column's +; the new card shows in its slot and grows in under it.
          this.squash(cursor, run)
          this.release(step, null)
          await nextFrame()
          const el = cardEl(step.card)
          if (el) {
            run.cleanups.push(() => {
              el.style.opacity = ""
              el.style.scale = ""
            })
            trail(el, color)
          }
          const at = el ? grab(el.getBoundingClientRect()) : null
          const from = { x: cursor.x, y: cursor.y }
          await this.phase(run, p.ms, (t) => {
            const k = easeOut(t)
            if (el) {
              el.style.opacity = String(k)
              el.style.scale = String(lerp(0.94, 1, k))
            }
            if (at) this.moveCursor(cursor, lerp(from.x, at.x, k), lerp(from.y, at.y, k))
          })
          if (el) {
            el.style.opacity = ""
            el.style.scale = ""
          }
          break
        }
        case "type": {
          // The title types out, letter by letter.
          const title = this.targetOf(step)?.querySelector<HTMLElement>("[data-card-title]") ?? null
          const card = this.targetOf(step)
          if (card && step.kind === "title") trail(card, color)
          if (!title) {
            await this.phase(run, p.ms, () => {})
            break
          }
          const letters = Math.max(1, Math.min(48, title.textContent?.length ?? 1))
          run.cleanups.push(() => (title.style.clipPath = ""))
          await this.phase(run, p.ms, (t) => {
            const shown = Math.floor(t * letters) / letters
            title.style.clipPath = t >= 1 ? "" : `inset(0 ${(1 - shown) * 100}% 0 0)`
          })
          title.style.clipPath = ""
          break
        }
        case "pulse": {
          const el = this.targetOf(step)
          if (el) {
            trail(el, color)
            el.querySelector<HTMLElement>("[data-card-chips]")?.animate([{ scale: 1 }, { scale: 1.06 }, { scale: 1 }], { duration: p.ms * run.scale, easing: "ease-out" })
          }
          await this.phase(run, p.ms, () => {})
          break
        }
        case "bubble": {
          const el = this.targetOf(step)
          if (el) trail(el, color)
          const bubble = this.bubble(step, color)
          run.cleanups.push(() => bubble.remove())
          await this.phase(run, p.ms, (t) => {
            const target = this.targetOf(step)
            if (target) {
              const r = target.getBoundingClientRect()
              const p2 = clampToBoard(r.right - 12, r.top - 6)
              bubble.style.transform = `translate(${p2.x}px, ${p2.y}px) translate(-100%, -100%) scale(${t < 0.15 ? lerp(0.6, 1, easeOut(t / 0.15)) : 1})`
            }
            bubble.style.opacity = String(t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1)
          })
          bubble.remove()
          break
        }
      }
    }
  }

  /** Waiting → flying: a ghost takes over from the hole, which keeps its space until the travel. */
  private takeOff(step: CursorStep, held: Held) {
    if (!held.ghost) {
      const src = held.holeId != null ? holeEl(held.holeId) : null
      if (src) {
        const r = src.getBoundingClientRect()
        held.g = { ...held.g, x: r.left, y: r.top, w: r.width, h: r.height }
      }
      const from = src ?? cardEl(step.card)
      if (from) {
        const ghost = from.cloneNode(true) as HTMLElement
        for (const a of COPY_STRIPS) ghost.removeAttribute(a)
        ghost.setAttribute("aria-hidden", "true")
        ghost.dataset.agentGhost = step.card
        Object.assign(ghost.style, {
          position: "fixed",
          left: "0px",
          top: "0px",
          width: `${held.g.w}px`,
          height: `${held.g.h}px`,
          margin: "0",
          zIndex: "1",
          willChange: "transform",
          transformOrigin: "50% 50%",
          boxSizing: "border-box",
        })
        held.ghost = ghost
        this.layer().prepend(ghost)
        drawGhost(held)
      }
    }
    const id = held.holeId
    this.change((pending, holes) => {
      pending.set(step.card, "flying")
      const i = holes.findIndex((h) => h.id === id)
      if (i !== -1) holes[i] = { ...holes[i]!, hidden: true }
    })
  }

  private bubble(step: CursorStep, color: string): HTMLElement {
    const el = document.createElement("div")
    el.className = "agent-bubble"
    el.dataset.agentBubble = step.card
    el.style.setProperty("--agent", color)
    el.textContent = step.note ?? ""
    el.style.opacity = "0"
    this.layer().append(el)
    return el
  }

  /** A claim that moved the card: "Claimed" pops beside it once it lands, then fades on its own. */
  private trailBubble(step: CursorStep, card: HTMLElement) {
    const el = this.bubble(step, this.colorOf(step.lane))
    const r = card.getBoundingClientRect()
    const p = clampToBoard(r.right - 12, r.top - 6)
    el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-100%, -100%)`
    el.style.opacity = ""
    el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 1, offset: 0.8 }, { opacity: 0 }], { duration: PACING.trail + 300 }).onfinish = () =>
      el.remove()
  }
}

// ---------------------------------------------------------------------------
// DOM helpers

const esc = cssString
const cardEl = (card: string) => document.querySelector<HTMLElement>(`[data-card-id="${esc(card)}"]`)
const holeEl = (id: number) => document.querySelector<HTMLElement>(`[data-agent-hole="${id}"]`)
const holeOfCard = (card: string) => document.querySelector<HTMLElement>(`[data-agent-hole-card="${esc(card)}"]`)
const plusOf = (statusId: string | undefined) =>
  statusId ? document.querySelector<HTMLElement>(`[data-status-id="${esc(statusId)}"] [data-column-plus]`) : null
const keyOf = (el: HTMLElement): string | null => el.dataset?.cardId ?? el.dataset?.agentHoleCard ?? null
const boardRect = () => document.querySelector<HTMLElement>("[data-agent-board]")?.getBoundingClientRect() ?? null
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

const insideBoard = (r: DOMRect) => {
  const b = boardRect()
  return !b || (r.bottom > b.top && r.top < b.bottom && r.right > b.left && r.left < b.right)
}

/** Off the board's visible area, the cursor waits at its edge, pointing the way. */
const clampToBoard = (x: number, y: number) => {
  const b = boardRect()
  if (!b) return { x, y }
  const pad = 10
  return { x: Math.min(Math.max(x, b.left + pad), b.right - pad), y: Math.min(Math.max(y, b.top + pad), b.bottom - pad) }
}

function stopBlink(cursor: Cursor) {
  cursor.blink?.cancel()
  cursor.blink = null
}

function drawGhost(held: Held) {
  const ghost = held.ghost
  if (!ghost) return
  const { x, y, scale, rot, lift } = held.g
  ghost.style.transform = `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${scale})`
  ghost.style.boxShadow = lift > 0.01 ? `0 ${4 + 10 * lift}px ${8 + 18 * lift}px rgb(15 23 42 / ${0.08 + 0.18 * lift})` : ""
}

/** The ring a change leaves on its card, in the session's colour; it fades by itself. */
function trail(el: HTMLElement, color: string) {
  el.animate(
    [
      { outlineColor: color, outlineWidth: "2px", outlineStyle: "solid", outlineOffset: "2px" },
      { outlineColor: "transparent", outlineWidth: "2px", outlineStyle: "solid", outlineOffset: "2px" },
    ],
    { duration: PACING.trail, easing: "ease-out" },
  )
}

// ---------------------------------------------------------------------------

/** The board's one animator. */
export const animator = new Animator()

/** What the board renders: hidden cards and holes. */
export const useCursorVisual = (): Visual => useSyncExternalStore(animator.subscribe, animator.snapshot)
