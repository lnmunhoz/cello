import { beforeEach, describe, expect, it } from "vitest"
import { durationOf, PACING, type Motion, type Phase, type StepKind } from "./pacing.ts"
import { CursorQueue, type Playback, type Player, type QueueStep, type Scheduler } from "./queue.ts"

/** A clock the test moves by hand: timers fire only inside `advance`, in time order. */
const testClock = () => {
  let now = 0
  let seq = 0
  let timers: Array<{ at: number; seq: number; fn: () => void }> = []
  const scheduler: Scheduler = {
    now: () => now,
    after: (ms, fn) => {
      const timer = { at: now + Math.max(0, ms), seq: seq++, fn }
      timers.push(timer)
      return () => {
        timers = timers.filter((t) => t !== timer)
      }
    },
  }
  const advance = (ms: number) => {
    const end = now + ms
    for (;;) {
      const next = [...timers].sort((a, b) => a.at - b.at || a.seq - b.seq)[0]
      if (!next || next.at > end) break
      timers = timers.filter((t) => t !== next)
      now = next.at
      next.fn()
    }
    now = end
  }
  return { scheduler, advance, now: () => now }
}

interface Step extends QueueStep {
  readonly name: string
}

const step = (lane: string, name: string, kind: StepKind = "move", card = name, holds = kind === "move" || kind === "create"): Step => ({
  lane,
  name,
  card,
  kind,
  holds,
})

/**
 * A player whose steps take their phases' length times their scale, like Motion's `speed`: a scale
 * change mid-step stretches or shrinks only what's left. Logs what the queue asks of it.
 */
const fakePlayer = (clock: ReturnType<typeof testClock>) => {
  const log: string[] = []
  const phases = new Map<string, ReadonlyArray<Phase>>()
  const scales = new Map<string, number[]>()
  const player: Player<Step> = {
    play(s, ph, scale, done) {
      log.push(`${clock.now()} play ${s.name}`)
      phases.set(s.name, ph)
      scales.set(s.name, [scale])
      const total = durationOf(ph)
      let progress = 0 // in full-speed ms
      let since = clock.now()
      let current = scale
      let cancel = clock.scheduler.after(total * scale, finish)
      function finish() {
        log.push(`${clock.now()} done ${s.name}`)
        done()
      }
      const playback: Playback = {
        setScale(next) {
          progress += (clock.now() - since) / current
          since = clock.now()
          current = next
          scales.get(s.name)!.push(next)
          cancel()
          cancel = clock.scheduler.after((total - progress) * next, finish)
        },
        cancel() {
          log.push(`${clock.now()} cancel ${s.name}`)
          cancel()
        },
      }
      return playback
    },
    drop: (s) => log.push(`${clock.now()} drop ${s.name}`),
    handOver: (from, to) => log.push(`${clock.now()} hand ${from.name} to ${to.name}`),
    idle: (lane) => log.push(`${clock.now()} idle ${lane}`),
    skipped: (lane, count) => log.push(`${clock.now()} skipped ${lane} ${count}`),
  }
  return { player, log, phases, scales }
}

const MOVE = 300 + 110 + 480 + 150 // 1040 ms at full speed

let clock: ReturnType<typeof testClock>
let fake: ReturnType<typeof fakePlayer>
let motion: Motion
let queue: CursorQueue<Step>

beforeEach(() => {
  clock = testClock()
  fake = fakePlayer(clock)
  motion = "full"
  queue = new CursorQueue(fake.player, clock.scheduler, { motion: () => motion })
})

describe("CursorQueue: one session", () => {
  it("plays its steps in order, one at a time, a gap apart", () => {
    queue.push(step("A", "a"))
    queue.push(step("A", "b", "comment"))
    clock.advance(10_000)
    const plays = fake.log.filter((l) => / (play|done) /.test(l))
    expect(plays.map((l) => l.split(" ").slice(1).join(" "))).toEqual(["play a", "done a", "play b", "done b"])
    // The comment starts one gap after the move ends: its start is the move's (sped-up) end + gap.
    const doneA = Number(plays[1]!.split(" ")[0])
    expect(Number(plays[2]!.split(" ")[0])).toBe(doneA + PACING.gap)
  })

  it("plays one move in about 1.1 s at full speed", () => {
    queue.push(step("A", "a"))
    clock.advance(MOVE - 1)
    expect(fake.log).toEqual(["0 play a"])
    clock.advance(1)
    expect(fake.log).toEqual(["0 play a", `${MOVE} done a`])
    expect(MOVE + PACING.gap).toBeCloseTo(1100, -2)
  })

  it("fades its cursor 600 ms after its last step, unless another arrives first", () => {
    queue.push(step("A", "a"))
    clock.advance(MOVE + 500)
    queue.push(step("A", "b", "field"))
    clock.advance(PACING.cursorLinger)
    expect(fake.log.some((l) => l.includes("idle"))).toBe(false)
    clock.advance(10_000)
    expect(fake.log.filter((l) => l.includes("idle"))).toHaveLength(1)
    const doneB = Number(fake.log.find((l) => l.endsWith("done b"))!.split(" ")[0])
    expect(fake.log.at(-1)).toBe(`${doneB + PACING.gap + PACING.cursorLinger} idle A`)
  })
})

describe("CursorQueue: several sessions", () => {
  it("plays different sessions at the same time", () => {
    queue.push(step("A", "a1"))
    queue.push(step("B", "b1"))
    queue.push(step("A", "a2"))
    expect(fake.log).toEqual(["0 play a1", "0 play b1"])
    clock.advance(MOVE)
    expect(fake.log).toContain(`${MOVE} done b1`)
  })
})

describe("CursorQueue: catching up", () => {
  it("speeds every step up as 2 / waiting once more than 2 wait, down to 0.35", () => {
    for (const name of ["a", "b", "c", "d"]) queue.push(step("A", name))
    // a started alone at full speed, then sped up as b, c and d arrived.
    expect(fake.scales.get("a")).toEqual([1, 2 / 3, 0.5])
    clock.advance(10_000)
    // b plays with c and d still waiting (3), c with d (2): full speed again.
    expect(fake.scales.get("b")![0]).toBeCloseTo(2 / 3)
    expect(fake.scales.get("c")![0]).toBe(1)
    expect(fake.scales.get("d")![0]).toBe(1)
  })

  it("never goes faster than 0.35 of full speed", () => {
    for (const name of ["a", "b", "c", "d", "e", "f", "g", "h"]) queue.push(step("A", name))
    expect(Math.min(...fake.scales.get("a")!)).toBe(0.35)
  })

  it("skips to the end above 8 waiting: drops what's left, says how many changes, and plays again after 700 ms of quiet", () => {
    for (let i = 1; i <= 9; i++) queue.push(step("A", `s${i}`))
    expect(fake.log).toContain("0 skipped A 9")
    expect(fake.log.filter((l) => l.includes(" drop "))).toHaveLength(9)
    expect(fake.log).toContain("0 cancel s1")
    expect(queue.waiting("A")).toBe(0)

    // More changes while skipping land at once and update the count.
    clock.advance(500)
    queue.push(step("A", "s10"))
    expect(fake.log.slice(-2)).toEqual(["500 drop s10", "500 skipped A 10"])

    // 700 ms of quiet: the session goes back to playing.
    clock.advance(PACING.quietMs)
    expect(fake.log.at(-1)).toBe(`${500 + PACING.quietMs} idle A`)
    queue.push(step("A", "s11"))
    expect(fake.log.at(-1)).toBe(`${500 + PACING.quietMs} play s11`)
  })

  it("keeps the board at most a few seconds behind: a burst of 20 is done well before 20 moves' time", () => {
    for (let i = 1; i <= 20; i++) {
      queue.push(step("A", `s${i}`))
      clock.advance(45)
    }
    clock.advance(PACING.quietMs + PACING.cursorLinger)
    expect(fake.log.some((l) => l.includes("skipped A"))).toBe(true)
    expect(queue.waiting("A")).toBe(0)
  })
})

describe("CursorQueue: reduced motion", () => {
  it("plays a short highlight instead of a flight", () => {
    motion = "reduced"
    queue.push(step("A", "a"))
    expect(fake.phases.get("a")!.map((p) => p.name)).toEqual(["highlight"])
    clock.advance(600)
    expect(fake.log).toEqual(["0 play a", "600 done a"])
  })

  it("checks the motion when each step starts, so Lucas's drag calms the steps that start during it", () => {
    queue.push(step("A", "a"))
    queue.push(step("A", "b", "field"))
    motion = "reduced"
    clock.advance(10_000)
    expect(fake.phases.get("a")!.map((p) => p.name)).toEqual(["glide", "lift", "travel", "land"])
    expect(fake.phases.get("b")!.map((p) => p.name)).toEqual(["highlight"])
  })
})

describe("CursorQueue: the same card twice", () => {
  it("newest wins: a queued move hands what it holds on screen to the newer move of the same card", () => {
    queue.push(step("A", "a0", "move", "other"))
    queue.push(step("A", "a1", "move", "x"))
    expect(queue.push(step("B", "b1", "move", "x"))).toBe("merged")
    expect(fake.log).toContain("0 hand a1 to b1")
    expect(fake.log).toContain("0 play b1")
    clock.advance(10_000)
    expect(fake.log.some((l) => l.endsWith("play a1"))).toBe(false)
  })

  it("a move of a card already flying leaves that flight to carry it on (it aims at the card's slot as it is now)", () => {
    queue.push(step("A", "a1", "move", "x"))
    clock.advance(400)
    expect(queue.push(step("B", "b1", "move", "x"))).toBe("dropped")
    clock.advance(10_000)
    expect(fake.log.some((l) => l.endsWith("play b1"))).toBe(false)
    expect(fake.log).toContain(`${MOVE} done a1`)
  })

  it("a move of a card still waiting to be created is left to the create, which shows the card wherever it is by then", () => {
    queue.push(step("A", "a0", "move", "other"))
    queue.push(step("A", "new", "create", "y"))
    expect(queue.push(step("A", "moveNew", "move", "y"))).toBe("dropped")
    clock.advance(10_000)
    expect(fake.log.some((l) => l.endsWith("play new"))).toBe(true)
    expect(fake.log.some((l) => l.endsWith("play moveNew"))).toBe(false)
  })

  it("changes that hold nothing (a comment, an edit) never merge", () => {
    queue.push(step("A", "c1", "comment", "x"))
    expect(queue.push(step("B", "c2", "title", "x"))).toBe("queued")
    expect(fake.log).toEqual(["0 play c1", "0 play c2"])
  })
})

describe("CursorQueue: Lucas wins", () => {
  it("grabbing a card stops its step at once, and the session moves on", () => {
    queue.push(step("A", "a"))
    queue.push(step("A", "b", "field"))
    clock.advance(200)
    queue.release("a")
    expect(fake.log.slice(-3)).toEqual(["200 cancel a", "200 drop a", "200 play b"])
  })

  it("grabbing a card whose step is queued drops it from the queue", () => {
    queue.push(step("A", "a"))
    queue.push(step("A", "b"))
    queue.release("b")
    expect(fake.log.at(-1)).toBe("0 drop b")
    clock.advance(10_000)
    expect(fake.log.some((l) => l.endsWith("play b"))).toBe(false)
  })

  it("starting a drag lands every step that holds a card, in every session; the others still play", () => {
    queue.push(step("A", "a"))
    queue.push(step("A", "c", "comment", "a"))
    queue.push(step("B", "b"))
    queue.releaseAll()
    expect(fake.log).toEqual(expect.arrayContaining(["0 cancel a", "0 drop a", "0 cancel b", "0 drop b", "0 play c"]))
    expect(queue.holding("a")).toBe(false)
    expect(queue.holding("b")).toBe(false)
  })

  it("clear() drops everything and plays nothing after", () => {
    queue.push(step("A", "a"))
    queue.push(step("A", "b"))
    queue.push(step("B", "c", "comment"))
    queue.clear()
    clock.advance(10_000)
    expect(fake.log.filter((l) => l.includes(" play "))).toEqual(["0 play a", "0 play c"])
    expect(fake.log.filter((l) => l.includes(" drop ")).length).toBe(3)
  })
})
