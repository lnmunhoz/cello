// Agent activity: a fake `task.moved` event source plus the visual layer that
// animates each move with the agent's labelled cursor.
//
// Rules:
// - The store applies every event immediately. The animator only reads the DOM
//   before the store changes (to record where the card was) and draws on top.
// - Nothing here ever blocks or rewrites the store. If the animator throws,
//   the move still lands.
//
// What a move looks like while it waits and while it plays:
// - queued: the card is hidden at its new slot (takes no space) and a static copy
//   stays in its old slot (a "hole" rendered by React, so it reflows with its column).
// - flying: the old slot's copy is replaced by a ghost on the agent layer; the new
//   slot holds an invisible spacer of the card's size; the ghost flies to the spacer.
// - landed: the spacer becomes the real card.
import { animate } from "motion"
import { useSyncExternalStore } from "react"
import { CARDS, COLUMNS, store } from "./store"

export type Agent = { id: string; name: string; color: string }

export const AGENTS: Record<string, Agent> = {
  claude: { id: "claude", name: "Claude · thailookup", color: "#d97757" },
  codex: { id: "codex", name: "Codex · cello", color: "#0f9f7a" },
  gemini: { id: "gemini", name: "Gemini · docs", color: "#4f6bff" },
}

export type TaskMoved = {
  type: "task.moved"
  agent: Agent
  card: string
  to: string
  index: number
  at: number
}

// Pacing, in ms at full speed. Tuned by watching the recorded videos.
export const PACING = {
  glide: 300, // cursor travels to the card (shorter for short hops)
  lift: 110, // card lifts
  travel: 480, // card + cursor fly to the slot
  land: 150, // card settles
  gap: 60, // pause between two moves of the same agent
  shrinkAt: 2, // moves waiting (incl. the one playing) above which everything speeds up
  minScale: 0.35, // fastest a move gets, as a share of its full duration
  skipAt: 8, // moves waiting above which the lane skips to the end
  quietMs: 700, // a skipping lane resets after this much silence
  cursorLinger: 600, // cursor stays this long after the last move, then fades
}

const prefersReduced = () =>
  typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches

// ---------------------------------------------------------------------------
// Visual state React reads. Changes on enqueue / start / land, never per frame.

export type Hole = { id: number; card: string; column: string; index: number; after: string | null; hidden: boolean }

const visual = {
  pending: new Map<string, "queued" | "flying">(),
  holes: new Map<number, Hole>(),
  version: 0,
}
const visualListeners = new Set<() => void>()
function notify() {
  visual.version++
  visualListeners.forEach((l) => l())
}
export function useVisual() {
  useSyncExternalStore(
    (l) => {
      visualListeners.add(l)
      return () => visualListeners.delete(l)
    },
    () => visual.version
  )
  return visual
}

type Toast = { id: string; text: string; color: string }
const toastListeners = new Set<(t: Toast) => void>()
export function onToast(l: (t: Toast) => void) {
  toastListeners.add(l)
  return () => {
    toastListeners.delete(l)
  }
}

// ---------------------------------------------------------------------------

type G = { x: number; y: number; w: number; h: number; scale: number; rot: number; lift: number; opacity: number }

type Entry = {
  id: number
  lane: Lane
  card: string
  ghost: HTMLElement | null
  g: G // where the card is on screen (recorded rect, then the ghost)
  holeId: number | null
  state: "queued" | "flying" | "done"
  cancelled: boolean
  stop?: () => void
  controls?: { speed: number }
}

let nextId = 1
const byCard = new Map<string, Entry>()
const lanes = new Map<string, Lane>()
let userDragging: string | null = null

export const stats = {
  events: 0,
  started: 0,
  landed: 0,
  merged: 0,
  cancelledByUser: 0,
  skipped: 0,
  log: [] as string[],
}

function layer() {
  let el = document.getElementById("agent-layer")
  if (!el) {
    el = document.createElement("div")
    el.id = "agent-layer"
    document.body.append(el)
  }
  return el
}

const cardEl = (card: string) => document.querySelector<HTMLElement>(`[data-card-id="${card}"]`)
const holeEl = (id: number | null) => (id == null ? null : document.querySelector<HTMLElement>(`[data-hole="${id}"]`))

function applyGhost(e: Entry) {
  if (!e.ghost) return
  const { x, y, scale, rot, lift, opacity } = e.g
  const s = e.ghost.style
  s.transform = `translate(${x}px, ${y}px) rotate(${rot}deg) scale(${scale})`
  s.boxShadow = lift > 0.01 ? `0 ${4 + 10 * lift}px ${8 + 18 * lift}px rgba(15,23,42,${0.08 + 0.18 * lift})` : ""
  s.opacity = String(opacity)
}

function makeGhost(from: HTMLElement, e: Entry) {
  const ghost = from.cloneNode(true) as HTMLElement
  for (const a of ["data-card-id", "data-hole", "data-hole-card", "data-pending", "data-moving", "data-dragging", "tabindex", "id", "role", "style"])
    ghost.removeAttribute(a)
  ghost.setAttribute("aria-hidden", "true")
  ghost.setAttribute("data-ghost", e.card)
  Object.assign(ghost.style, {
    position: "fixed",
    left: "0px",
    top: "0px",
    width: `${e.g.w}px`,
    height: `${e.g.h}px`,
    margin: "0",
    zIndex: "40",
    willChange: "transform",
    transformOrigin: "50% 50%",
  })
  e.ghost = ghost
  layer().append(ghost)
  applyGhost(e)
}

function setHoleHidden(id: number | null) {
  const h = id == null ? undefined : visual.holes.get(id)
  if (h) visual.holes.set(h.id, { ...h, hidden: true })
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

/** One timed step on motion's frame loop. Resolves false if cancelled. */
function phase(e: Entry | null, ms: number, fn: (t: number) => void, owner?: { stop?: () => void }) {
  return new Promise<boolean>((resolve) => {
    if (e?.cancelled) return resolve(false)
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      resolve(ok)
    }
    const controls = animate(0, 1, {
      duration: Math.max(ms, 1) / 1000,
      ease: "linear",
      onUpdate: (t) => {
        if (!e?.cancelled) fn(t)
      },
      onComplete: () => {
        if (!e?.cancelled) fn(1)
        finish(!e?.cancelled)
      },
    })
    const stop = () => {
      controls.stop()
      finish(false)
    }
    if (e) {
      controls.speed = 1 / e.lane.scale()
      e.controls = controls
      e.stop = stop
    }
    if (owner) owner.stop = stop
  })
}

// ---------------------------------------------------------------------------

class Lane {
  queue: Entry[] = []
  current: Entry | null = null
  cursor: HTMLElement | null = null
  cx = 0
  cy = 0
  cursorFade: { stop?: () => void } = {}
  runCount = 0
  skipping = false
  idleTimer: number | undefined
  toastId = ""

  constructor(public agent: Agent) {}

  outstanding() {
    return this.queue.length + (this.current ? 1 : 0)
  }

  /** Share of the full duration a move gets, given how much is waiting. */
  scale() {
    const n = this.outstanding()
    return n <= PACING.shrinkAt ? 1 : Math.max(PACING.minScale, PACING.shrinkAt / n)
  }

  /** The queue changed: the move in flight speeds up right away. */
  retime() {
    const c = this.current?.controls
    if (c && Math.abs(c.speed - 1 / this.scale()) > 0.01) {
      c.speed = 1 / this.scale()
      stats.log.push(`${this.agent.id} retime ${this.current!.card} scale=${this.scale().toFixed(2)} queue=${this.outstanding()}`)
    }
  }

  ensureCursor() {
    this.cursorFade.stop?.()
    if (this.cursor) {
      this.cursor.style.opacity = "1"
      return false
    }
    const el = document.createElement("div")
    el.className = "agent-cursor"
    el.setAttribute("data-agent-cursor", this.agent.id)
    el.style.setProperty("--agent", this.agent.color)
    el.innerHTML = `<svg width="18" height="20" viewBox="0 0 18 20" aria-hidden="true"><path d="M1 1 L1 16 L5.2 12.4 L8 19 L10.8 17.8 L8.1 11.4 L14 11.4 Z" fill="var(--agent)" stroke="white" stroke-width="1.4" stroke-linejoin="round"/></svg><span>${this.agent.name}</span>`
    el.style.opacity = "0"
    layer().append(el)
    this.cursor = el
    return true
  }

  moveCursor(x: number, y: number) {
    this.cx = x
    this.cy = y
    if (this.cursor) this.cursor.style.transform = `translate(${x}px, ${y}px)`
  }

  clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = undefined
  }

  scheduleIdle(delay?: number) {
    this.clearIdle()
    this.idleTimer = window.setTimeout(
      () => {
        this.idleTimer = undefined
        if (this.outstanding()) return
        this.skipping = false
        this.runCount = 0
        const el = this.cursor
        if (!el) return
        phase(null, 220, (t) => (el.style.opacity = String(1 - t)), this.cursorFade).then((ok) => {
          if (ok && this.cursor === el && !this.outstanding()) {
            el.remove()
            this.cursor = null
          }
        })
      },
      delay ?? (this.skipping ? PACING.quietMs : PACING.cursorLinger)
    )
  }

  async pump() {
    if (this.current || this.skipping) return
    const next = this.queue.shift()
    if (!next) {
      this.scheduleIdle()
      return
    }
    this.clearIdle()
    this.current = next
    stats.started++
    stats.log.push(`${this.agent.id} play ${next.card} scale=${this.scale().toFixed(2)} queue=${this.outstanding()}`)
    let ok = false
    try {
      ok = await (prefersReduced() ? playReduced(next) : play(next))
    } catch (err) {
      console.error(err)
      if (!next.cancelled) finishNow(next)
    }
    if (ok) {
      land(next)
      await new Promise((r) => setTimeout(r, PACING.gap * this.scale()))
    }
    if (this.current === next) this.current = null
    this.pump()
  }

  enterSkip() {
    this.skipping = true
    for (const e of [...this.queue]) finishNow(e)
    this.queue = []
    if (this.current) finishNow(this.current)
    this.current = null
    this.cursorFade.stop?.()
    this.cursor?.remove()
    this.cursor = null
    this.toastId = `skip-${this.agent.id}-${Date.now()}`
    this.toast()
    this.scheduleIdle()
  }

  toast() {
    const short = this.agent.name.split(" · ")[0]
    const t = { id: this.toastId, text: `${short} made ${this.runCount} changes`, color: this.agent.color }
    toastListeners.forEach((l) => l(t))
  }
}

function laneFor(agent: Agent) {
  let lane = lanes.get(agent.id)
  if (!lane) lanes.set(agent.id, (lane = new Lane(agent)))
  return lane
}

function targetRect(e: Entry, fallback: { x: number; y: number }) {
  const el = cardEl(e.card)
  if (!el) return { left: fallback.x, top: fallback.y }
  const r = el.getBoundingClientRect()
  return { left: r.left, top: r.top }
}

/** Queued → flying: ghost takes over from the source copy, the target slot opens. */
function takeOff(e: Entry) {
  e.state = "flying"
  if (!e.ghost) {
    const src = holeEl(e.holeId)
    if (src) {
      const r = src.getBoundingClientRect()
      e.g.x = r.left
      e.g.y = r.top
      e.g.w = r.width
      e.g.h = r.height
    }
    const from = src ?? cardEl(e.card)
    if (from) makeGhost(from, e)
  }
  setHoleHidden(e.holeId)
  visual.pending.set(e.card, "flying")
  notify()
}

async function play(e: Entry) {
  const lane = e.lane
  const fresh = lane.ensureCursor()
  // Aim at the source copy if there is one (it may have moved since the event).
  const src = holeEl(e.holeId)
  const at = src ? src.getBoundingClientRect() : { left: e.g.x, top: e.g.y }
  const grabDx = e.g.w * 0.3
  const grabDy = e.g.h * 0.55
  if (fresh) lane.moveCursor(at.left + grabDx - 70, at.top + grabDy + 50)
  // 1. cursor glides to the card
  const c0 = { x: lane.cx, y: lane.cy }
  const startOpacity = Number(lane.cursor?.style.opacity ?? 1)
  const dist = Math.hypot(at.left + grabDx - c0.x, at.top + grabDy - c0.y)
  const glide = Math.min(PACING.glide, 120 + dist * 0.35)
  let ok = await phase(e, glide, (t) => {
    const k = easeOut(t)
    const r = e.ghost ? { left: e.g.x, top: e.g.y } : holeEl(e.holeId)?.getBoundingClientRect() ?? at
    lane.moveCursor(lerp(c0.x, r.left + grabDx, k), lerp(c0.y, r.top + grabDy, k))
    if (lane.cursor && startOpacity < 1) lane.cursor.style.opacity = String(lerp(startOpacity, 1, Math.min(1, t * 2)))
  })
  if (!ok) return false
  takeOff(e)
  // 2. card lifts
  const g0 = { ...e.g }
  ok = await phase(e, PACING.lift, (t) => {
    const k = easeOut(t)
    e.g.scale = lerp(g0.scale, 1.04, k)
    e.g.rot = lerp(g0.rot, -1.5, k)
    e.g.lift = lerp(g0.lift, 1, k)
    applyGhost(e)
    lane.moveCursor(e.g.x + grabDx, e.g.y + grabDy)
  })
  if (!ok) return false
  // 3. travel: the old slot closes while the ghost flies to the spacer
  if (e.holeId != null) {
    visual.holes.delete(e.holeId)
    e.holeId = null
    notify()
  }
  const from = { x: e.g.x, y: e.g.y }
  ok = await phase(e, PACING.travel, (t) => {
    const k = easeInOut(t)
    const r = targetRect(e, from)
    e.g.x = lerp(from.x, r.left, k)
    e.g.y = lerp(from.y, r.top, k)
    applyGhost(e)
    lane.moveCursor(e.g.x + grabDx, e.g.y + grabDy)
  })
  if (!ok) return false
  // 4. land
  const g1 = { ...e.g }
  ok = await phase(e, PACING.land, (t) => {
    const k = easeOut(t)
    const r = targetRect(e, g1)
    e.g.x = r.left
    e.g.y = r.top
    e.g.scale = lerp(g1.scale, 1, k)
    e.g.rot = lerp(g1.rot, 0, k)
    e.g.lift = lerp(g1.lift, 0, k)
    applyGhost(e)
    lane.moveCursor(e.g.x + grabDx, e.g.y + grabDy)
  })
  return ok
}

/** prefers-reduced-motion: no flight. The old copy fades out, the card fades in at its slot. */
async function playReduced(e: Entry) {
  const lane = e.lane
  lane.ensureCursor()
  takeOff(e)
  if (e.holeId != null) {
    visual.holes.delete(e.holeId)
    e.holeId = null
    notify()
  }
  await new Promise((r) => requestAnimationFrame(r)) // let the slot render
  const r = targetRect(e, e.g)
  lane.moveCursor(r.left + e.g.w * 0.3, r.top + e.g.h * 0.55)
  if (lane.cursor) lane.cursor.style.opacity = "1"
  let ok = await phase(e, 160, (t) => {
    e.g.opacity = 1 - t
    applyGhost(e)
  })
  if (!ok) return false
  const el = cardEl(e.card)
  ok = await phase(e, 220, (t) => {
    if (el) el.style.opacity = String(t)
  })
  return ok
}

/** Ends an entry: ghost and copy go, the real card shows at its slot. */
function land(e: Entry) {
  e.state = "done"
  e.ghost?.remove()
  e.ghost = null
  if (e.holeId != null) visual.holes.delete(e.holeId)
  e.holeId = null
  if (byCard.get(e.card) === e) {
    byCard.delete(e.card)
    visual.pending.delete(e.card)
    const el = cardEl(e.card)
    if (el) {
      el.style.opacity = ""
      el.removeAttribute("data-pending")
    }
  }
  stats.landed++
  notify()
}

/** Ends an entry at once, without animating it. */
function finishNow(e: Entry) {
  e.cancelled = true
  e.stop?.()
  stats.skipped++
  land(e)
  stats.landed--
}

// ---------------------------------------------------------------------------
// Public API

type Prepared =
  | { kind: "merge"; existing: Entry }
  | { kind: "new"; rect: DOMRect; from: string; fromIndex: number; after: string | null }
  | null

/** Runs before the store applies a move: records where the card is on screen. */
function prepare(ev: TaskMoved): Prepared {
  if (userDragging === ev.card) return null
  const existing = byCard.get(ev.card)
  if (existing) return { kind: "merge", existing }
  const el = cardEl(ev.card)
  const from = store.columnOf(ev.card)
  if (!el || !from) return null
  const list = store.get()[from]
  const fromIndex = list.indexOf(ev.card)
  return { kind: "new", rect: el.getBoundingClientRect(), from, fromIndex, after: fromIndex > 0 ? list[fromIndex - 1] : null }
}

function enqueue(p: Prepared, ev: TaskMoved) {
  if (!p) return
  const lane = laneFor(ev.agent)
  lane.runCount++
  lane.clearIdle()
  let entry: Entry
  if (p.kind === "merge") {
    // Newest wins. The card's older, not-yet-landed animation is dropped and the new
    // one starts from wherever the card is shown now (its old slot, or mid-air).
    const ex = p.existing
    stats.merged++
    if (ex.state === "flying" && lane !== ex.lane && lane.outstanding() > 0) {
      // The new agent is busy: let the flight in progress carry the card on to its
      // newest slot (targets are read live), rather than park a ghost mid-air.
      stats.log.push(`merge ${ev.card}: ${ex.lane.agent.id} flight retargeted for ${ev.agent.id}`)
      notify()
      return
    }
    stats.log.push(`merge ${ev.card}: ${ex.lane.agent.id} -> ${ev.agent.id}`)
    ex.cancelled = true
    ex.stop?.()
    if (ex.state === "queued") ex.lane.queue = ex.lane.queue.filter((q) => q !== ex)
    else if (ex.lane.current === ex) {
      ex.lane.current = null
      queueMicrotask(() => ex.lane.pump())
    }
    const wasFlying = ex.state === "flying"
    ex.state = "done"
    entry = { id: nextId++, lane, card: ev.card, ghost: ex.ghost, g: ex.g, holeId: ex.holeId, state: wasFlying ? "flying" : "queued", cancelled: false }
    ex.lane.retime()
  } else {
    const r = p.rect
    const holeId = nextId++
    visual.holes.set(holeId, { id: holeId, card: ev.card, column: p.from, index: p.fromIndex, after: p.after, hidden: false })
    entry = {
      id: nextId++,
      lane,
      card: ev.card,
      ghost: null,
      g: { x: r.left, y: r.top, w: r.width, h: r.height, scale: 1, rot: 0, lift: 0, opacity: 1 },
      holeId,
      state: "queued",
      cancelled: false,
    }
  }
  byCard.set(ev.card, entry)
  visual.pending.set(ev.card, entry.state === "flying" ? "flying" : "queued")
  notify()

  if (lane.skipping) {
    finishNow(entry)
    lane.toast()
    lane.scheduleIdle()
    return
  }
  lane.queue.push(entry)
  if (lane.outstanding() > PACING.skipAt) lane.enterSkip()
  else {
    lane.retime()
    lane.pump()
  }
}

/** The user picked up a card: any animation for it stops and the real card shows. */
export function userGrab(card: string | null) {
  userDragging = card
  if (!card) return
  const e = byCard.get(card)
  if (!e) return
  stats.cancelledByUser++
  stats.log.push(`user grabbed ${card} (${e.state}), animation cancelled`)
  const lane = e.lane
  e.cancelled = true
  e.stop?.()
  lane.queue = lane.queue.filter((q) => q !== e)
  const wasCurrent = lane.current === e
  land(e)
  stats.landed--
  if (wasCurrent) {
    lane.current = null
    lane.pump()
  }
  lane.retime()
  // The user took over: this agent's cursor gets out of the way at once.
  if (!lane.outstanding()) lane.scheduleIdle(0)
}

/** The one way events enter the board. */
export function handleEvent(ev: TaskMoved) {
  stats.events++
  let p: Prepared = null
  try {
    p = prepare(ev)
  } catch (err) {
    console.error(err)
  }
  store.move(ev.card, ev.to, ev.index) // the truth, applied now, whatever the animator does
  try {
    enqueue(p, ev)
  } catch (err) {
    console.error(err)
  }
}

export function activeGhosts() {
  return document.querySelectorAll("[data-ghost]").length
}

// ---------------------------------------------------------------------------
// Fake event source

const colIds = COLUMNS.map((c) => c.id)
const pick = <T,>(xs: readonly T[]) => xs[Math.floor(Math.random() * xs.length)]

function event(agent: Agent, card: string, to: string, index: number): TaskMoved {
  return { type: "task.moved", agent, card, to, index, at: Date.now() }
}

function randomMove(agent: Agent, avoid = new Set<string>()): TaskMoved {
  const lists = store.get()
  const cards = Object.keys(CARDS).filter((c) => !avoid.has(c))
  const card = pick(cards)
  const from = store.columnOf(card)!
  const to = pick(colIds.filter((c) => c !== from))
  const index = Math.floor(Math.random() * Math.min(6, lists[to].length + 1))
  return event(agent, card, to, index)
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const scenarios = {
  single(agentId = "claude") {
    const lists = store.get()
    const card = lists.backlog[3] ?? lists.todo[0]
    handleEvent(event(AGENTS[agentId], card, "doing", 2))
    return card
  },
  async parallel() {
    const lists = store.get()
    handleEvent(event(AGENTS.claude, lists.backlog[1], "done", 1))
    await wait(120)
    handleEvent(event(AGENTS.codex, lists.todo[2], "backlog", 0))
  },
  /** Two agents move the same card; the second one takes over mid-flight. */
  async sameCard(delay = 520) {
    const card = store.get().backlog[2]
    handleEvent(event(AGENTS.claude, card, "doing", 1))
    await wait(delay)
    handleEvent(event(AGENTS.codex, card, "done", 0))
    return card
  },
  /** Both agents queue a move of the same card behind other work: only the newest plays. */
  async queuedMerge() {
    const l = store.get()
    const a = l.backlog[0], b = l.todo[0], x = l.backlog[5]
    handleEvent(event(AGENTS.claude, a, "doing", 0))
    handleEvent(event(AGENTS.claude, x, "todo", 1))
    await wait(60)
    handleEvent(event(AGENTS.codex, b, "done", 0))
    handleEvent(event(AGENTS.codex, x, "done", 2))
    return x
  },
  async burst(agentId = "claude", n = 20, spacing = 45) {
    const agent = AGENTS[agentId]
    const used = new Set<string>()
    for (let i = 0; i < n; i++) {
      const ev = randomMove(agent, used)
      used.add(ev.card)
      handleEvent(ev)
      await wait(spacing)
    }
  },
  random(agentId?: string) {
    handleEvent(randomMove(AGENTS[agentId ?? pick(Object.keys(AGENTS))]))
  },
}

declare global {
  interface Window {
    __cello: unknown
  }
}
window.__cello = { scenarios, stats, handleEvent, activeGhosts, store, PACING, AGENTS, visual }
