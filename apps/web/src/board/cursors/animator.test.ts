// The animator's bookkeeping, with a stand-in for the few document calls it makes outside a flight
// (its style element and its layer). Flights themselves are covered by e2e/cursors.spec.ts.
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { Hole } from "./holes.ts"

class FakeElement {
  id = ""
  textContent = ""
  readonly style: Record<string, string> = {}
  readonly dataset: Record<string, string> = {}
  constructor(private readonly doc: FakeDocument) {}
  append(child: FakeElement) {
    if (child.id) this.doc.byId.set(child.id, child)
  }
  remove() {
    this.doc.byId.delete(this.id)
  }
  replaceChildren() {}
  setAttribute() {}
  querySelector() {
    return null
  }
}

class FakeDocument {
  readonly byId = new Map<string, FakeElement>()
  readonly head = new FakeElement(this)
  readonly body = new FakeElement(this)
  getElementById(id: string) {
    return this.byId.get(id) ?? null
  }
  createElement() {
    return new FakeElement(this)
  }
  querySelector() {
    return null
  }
}

let doc: FakeDocument
const styles = () => doc.getElementById("agent-cursor-styles")?.textContent ?? ""

beforeEach(() => {
  doc = new FakeDocument()
  ;(globalThis as { document?: unknown }).document = doc
})
afterEach(() => {
  delete (globalThis as { document?: unknown }).document
})

const { Animator } = await import("./animator.ts")
type Step = Parameters<InstanceType<typeof Animator>["drop"]>[0]

const step = (card: string): Step => ({ id: 1, lane: "s1", card, kind: "move", holds: true, actorId: "agent", note: null })
const hole = (id: number, card: string, hidden: boolean): Hole => ({ id, card, statusId: "todo", after: null, index: 0, hidden })

/** A move holding `card`: hidden (queued) or flying at its new slot, with a hole in its old one. */
function holding(animator: InstanceType<typeof Animator>, s: Step, state: "queued" | "flying", holeId: number) {
  animator["owner"].set(s.card, s)
  animator["held"].set(s, { holeId, ghost: null, g: { x: 0, y: 0, w: 280, h: 80, scale: 1, rot: 0, lift: 0 } })
  animator["change"]((pending, holes) => {
    pending.set(s.card, state)
    holes.push(hole(holeId, s.card, state === "flying"))
  })
}

const attach = (animator: InstanceType<typeof Animator>) =>
  animator.attach({ projectId: "p1", enabled: true, reduced: false, lookup: async () => ({ sessions: [] }) })

describe("Animator", () => {
  it("reset() and detach() leave its style rules empty", () => {
    const animator = new Animator()
    attach(animator)
    holding(animator, step("c1"), "queued", 7)
    expect(styles()).toBe('[data-card-id="c1"]{display:none !important}')
    animator.reset()
    expect(styles()).toBe("")
    expect(animator.snapshot().holes).toEqual([])

    holding(animator, step("c2"), "flying", 8)
    expect(styles()).not.toBe("")
    animator.detach()
    expect(styles()).toBe("")
  })

  it("a board closed in the middle of a drag doesn't leave cursors only highlighting", () => {
    const animator = new Animator()
    attach(animator)
    animator.setDragging(true)
    expect(animator.motion()).toBe("reduced")
    animator.detach()
    attach(animator)
    expect(animator.motion()).toBe("full")
  })

  it("a step dropped while Lucas drags keeps its hole's space until he lets go, so nothing in that column moves", () => {
    const animator = new Animator()
    attach(animator)
    const flying = step("c1")
    const waiting = { ...step("c2"), id: 2 }
    holding(animator, flying, "flying", 7)
    holding(animator, waiting, "queued", 8)

    animator.setDragging(true)
    animator.drop(flying)
    animator.drop(waiting)
    // The flying card shows in the space it already had; its hole stays as an empty space. The waiting
    // card stays as Lucas saw it: its copy in the old slot, hidden at the new one.
    expect(animator.snapshot().holes.map((h) => h.id)).toEqual([7, 8])
    expect(styles()).toBe(['[data-card-id="c2"]{display:none !important}', '[data-agent-hole="7"]{visibility:hidden}'].join("\n"))

    animator.setDragging(false)
    expect(animator.snapshot().holes).toEqual([])
    expect(styles()).toBe("")
  })

  it("a step that let go of its hole and was then dropped during the drag still closes that hole when he lets go", () => {
    // releaseAll() drops the playing step, the lane starts the next one (as a highlight, which lets go
    // of its hole), and then releaseAll() drops that one too, with no hole left to name.
    const animator = new Animator()
    attach(animator)
    const s = step("c1")
    holding(animator, s, "queued", 9)
    animator.setDragging(true)
    animator["release"](s, 9)
    animator["held"].delete(s)
    animator.drop(s)
    animator.setDragging(false)
    expect(animator.snapshot().holes).toEqual([])
    expect(styles()).toBe("")
  })
})
