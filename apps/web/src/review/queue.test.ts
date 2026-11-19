import { describe, expect, it } from "vitest"
import { allLeft, type DecisionState, decisionStep, filterQueue, type Held, holdStep, IDLE, nextAfterDecision, decisionStillOpen, overtaken, undoTarget, parseReviewSearch, decisionNote, rowKey, sortQueue, syncHeld, withHeld } from "./queue.ts"

describe("decisionStep: what a row shows from the click on Approve or Send back until it has left (CEL-187)", () => {
  const pending: DecisionState = { phase: "pending", decision: "approved" }
  const failed: DecisionState = { phase: "failed", decision: "sent_back", message: "Can't reach the Cello server" }

  it("a click is pending until the server answers", () => {
    expect(decisionStep(IDLE, { type: "clicked", decision: "approved" })).toEqual(pending)
    expect(decisionStep(IDLE, { type: "clicked", decision: "sent_back" })).toEqual({ phase: "pending", decision: "sent_back" })
  })

  it("the server took it: the row says so for a moment, then leaves, then is gone", () => {
    const decided = decisionStep(pending, { type: "taken" })
    expect(decided).toEqual({ phase: "decided", decision: "approved" })
    const leaving = decisionStep(decided, { type: "shown" })
    expect(leaving).toEqual({ phase: "leaving", decision: "approved" })
    expect(decisionStep(leaving, { type: "left" })).toEqual({ phase: "gone" })
  })

  it("it failed: the row keeps the message, and a second click tries again", () => {
    const refused = decisionStep({ phase: "pending", decision: "sent_back" }, { type: "refused", message: "Can't reach the Cello server" })
    expect(refused).toEqual(failed)
    expect(decisionStep(failed, { type: "clicked", decision: "approved" })).toEqual(pending)
  })

  it("anything out of turn changes nothing: a second click while pending doesn't decide twice", () => {
    expect(decisionStep(pending, { type: "clicked", decision: "sent_back" })).toBe(pending)
    expect(decisionStep(IDLE, { type: "taken" })).toBe(IDLE)
    expect(decisionStep(IDLE, { type: "shown" })).toBe(IDLE)
    expect(decisionStep(failed, { type: "left" })).toBe(failed)
    const decided: DecisionState = { phase: "decided", decision: "approved" }
    expect(decisionStep(decided, { type: "left" })).toBe(decided)
    expect(decisionStep(decided, { type: "clicked", decision: "sent_back" })).toBe(decided)
  })
})

describe("withHeld: a decided row stays where it was until it has left, though the events took it off the queue (CEL-187)", () => {
  const keyOf = (key: string) => key
  /** `dropped`: the queue has stopped listing the row since the click (the decision's events arrived). */
  const held = (key: string, at: number, phase: "pending" | "decided" | "leaving" | "gone", dropped = false): Held<string> => ({
    key, item: key, at, dropped, state: phase === "gone" ? { phase } : { phase, decision: "approved" },
  })

  it("the queue as it is, with nothing decided", () => {
    expect(withHeld(["CEL-3", "CEL-7"], keyOf, [])).toEqual(["CEL-3", "CEL-7"])
  })

  it("a pending row stays too: the decision's events can arrive before the command's answer", () => {
    expect(withHeld(["CEL-3", "THAI-2"], keyOf, [held("CEL-7", 1, "pending")])).toEqual(["CEL-3", "CEL-7", "THAI-2"])
  })

  it("holdStep moves one held row on, and lets go of a row whose decision failed or that has left", () => {
    const rows = [held("CEL-3", 0, "pending"), held("CEL-7", 1, "leaving")]
    expect(holdStep(rows, "CEL-3", { type: "taken" })).toEqual([held("CEL-3", 0, "decided"), held("CEL-7", 1, "leaving")])
    expect(holdStep(rows, "CEL-3", { type: "refused", message: "Can't reach the Cello server" })).toEqual([held("CEL-7", 1, "leaving")])
    expect(holdStep(rows, "CEL-9", { type: "taken" })).toEqual(rows)
    // It has left: let go once the queue has dropped it.
    expect(holdStep([held("CEL-3", 0, "pending"), held("CEL-7", 1, "leaving", true)], "CEL-7", { type: "left" })).toEqual([held("CEL-3", 0, "pending")])
  })

  it("a row that folded away before its events arrived stays out of the list until the queue drops it: it doesn't pop back", () => {
    const folded = holdStep([held("CEL-7", 1, "leaving")], "CEL-7", { type: "left" })
    expect(folded).toEqual([held("CEL-7", 1, "gone")])
    expect(withHeld(["CEL-3", "CEL-7"], keyOf, folded)).toEqual(["CEL-3"])
    // The events arrive: the queue drops it, and the hold is let go.
    expect(syncHeld(folded, ["CEL-3"])).toEqual([])
  })

  it("allLeft: every leaving row has left, whether the fold's end or the fallback timer says so; the others stay", () => {
    const rows = [held("CEL-3", 0, "decided", true), held("CEL-7", 1, "leaving", true), held("THAI-2", 2, "leaving")]
    expect(allLeft(rows)).toEqual([held("CEL-3", 0, "decided", true), held("THAI-2", 2, "gone")])
    expect(allLeft(allLeft(rows))).toEqual(allLeft(rows))
  })

  it("syncHeld notes when the queue drops a held row, and changes nothing otherwise", () => {
    const rows = [held("CEL-3", 0, "pending"), held("CEL-7", 1, "decided")]
    expect(syncHeld(rows, ["CEL-3", "CEL-7"])).toBe(rows)
    const dropped = syncHeld(rows, ["CEL-3"])
    expect(dropped).toEqual([held("CEL-3", 0, "pending"), held("CEL-7", 1, "decided", true)])
    expect(syncHeld(dropped, ["CEL-3"])).toBe(dropped)
  })

  it("a row the queue lists again after dropping it (a new packet came in) is let go and shows, in any phase", () => {
    for (const phase of ["pending", "decided", "leaving"] as const) {
      const rows = [held("CEL-7", 1, phase, true)]
      expect(syncHeld(rows, ["CEL-3", "CEL-7"])).toEqual([])
      // Even before the hold is let go, the list shows it: a leaving key isn't hidden once it's back.
      expect(withHeld(["CEL-3", "CEL-7"], keyOf, rows)).toEqual(["CEL-3", "CEL-7"])
    }
  })

  it("a decided row the queue dropped is still shown, in its place", () => {
    expect(withHeld(["CEL-3", "THAI-2"], keyOf, [held("CEL-7", 1, "decided")])).toEqual(["CEL-3", "CEL-7", "THAI-2"])
    expect(withHeld(["CEL-7", "THAI-2"], keyOf, [held("CEL-3", 0, "decided")])).toEqual(["CEL-3", "CEL-7", "THAI-2"])
    expect(withHeld([], keyOf, [held("CEL-3", 4, "decided")])).toEqual(["CEL-3"])
  })

  it("two rows decided one after the other both keep their place", () => {
    expect(withHeld(["THAI-2"], keyOf, [held("CEL-7", 1, "decided"), held("CEL-3", 0, "decided")])).toEqual(["CEL-3", "CEL-7", "THAI-2"])
  })

  it("a row the queue still lists (its events haven't arrived) is shown once", () => {
    expect(withHeld(["CEL-3", "CEL-7"], keyOf, [held("CEL-7", 1, "decided")])).toEqual(["CEL-3", "CEL-7"])
  })

  it("a leaving row is out of the list, so it can fold away, even while the queue still lists it (its events haven't arrived)", () => {
    expect(withHeld(["CEL-3", "THAI-2"], keyOf, [held("CEL-7", 1, "leaving", true)])).toEqual(["CEL-3", "THAI-2"])
    expect(withHeld(["CEL-3", "CEL-7"], keyOf, [held("CEL-7", 1, "leaving")])).toEqual(["CEL-3"])
  })
})

describe("parseReviewSearch: the open row lives in the URL", () => {
  it("keeps a task key, uppercased", () => {
    expect(parseReviewSearch({ open: "CEL-12" })).toEqual({ open: "CEL-12" })
    expect(parseReviewSearch({ open: "cel-12" })).toEqual({ open: "CEL-12" })
  })

  it("drops anything else", () => {
    for (const open of [undefined, "", "CEL", "../settings", 12, ["CEL-1"]]) expect(parseReviewSearch({ open })).toEqual({})
  })
})

describe("nextAfterDecision: after Approve or Send back, the next row opens", () => {
  const keys = ["CEL-3", "CEL-7", "THAI-2"]
  it("the row after the one decided", () => {
    expect(nextAfterDecision(keys, "CEL-3")).toBe("CEL-7")
    expect(nextAfterDecision(keys, "CEL-7")).toBe("THAI-2")
  })
  it("the one before it when it was the last, and none when it was the only one", () => {
    expect(nextAfterDecision(keys, "THAI-2")).toBe("CEL-7")
    expect(nextAfterDecision(["CEL-3"], "CEL-3")).toBeUndefined()
  })
  it("none for a row that isn't in the queue any more", () => {
    expect(nextAfterDecision(keys, "CEL-99")).toBeUndefined()
  })
})

describe("filterQueue: the Review page narrowed to a project (CEL-188)", () => {
  const item = (key: string, project: string) => ({ task: { key }, project: { id: project } })
  const items = [item("A-1", "pa"), item("B-1", "pb"), item("A-2", "pa")]

  it("keeps the project's rows in order; All keeps every row", () => {
    expect(filterQueue(items, "pa").map((i) => i.task.key)).toEqual(["A-1", "A-2"])
    expect(filterQueue(items, null).map((i) => i.task.key)).toEqual(["A-1", "B-1", "A-2"])
  })

  it("keeps a row with a decision in flight whatever its project, so it can say so and fold away", () => {
    expect(filterQueue(items, "pa", new Set(["B-1"])).map((i) => i.task.key)).toEqual(["A-1", "B-1", "A-2"])
  })

  it("a project with no rows has none", () => {
    expect(filterQueue(items, "pc")).toEqual([])
  })

  it("a pick during the confirmation: the decided row stays, and the next row to open is the next one shown", () => {
    // B-1 was approved (its events took it off the queue); Lucas picks Alpha while the row still says Approved.
    const queue = [item("A-1", "pa"), item("A-2", "pa")]
    const decided: Held<(typeof items)[number]> = { key: "B-1", item: item("B-1", "pb"), at: 1, dropped: true, state: { phase: "decided", decision: "approved" } }
    const keep = new Set([decided.key])
    const shown = filterQueue(withHeld(queue, (i) => i.task.key, [decided]), "pa", keep).map((i) => i.task.key)
    expect(shown).toEqual(["A-1", "B-1", "A-2"])
    // The confirmation ends: the row folds away, and the one that opens is the next shown, not a hidden one.
    expect(nextAfterDecision(shown, "B-1")).toBe("A-2")
    const after = filterQueue(withHeld(queue, (i) => i.task.key, [{ ...decided, state: { phase: "leaving", decision: "approved" } }]), "pa", new Set()).map((i) => i.task.key)
    expect(after).toEqual(["A-1", "A-2"])
  })
})

describe("sortQueue: the Review page's order (CEL-188)", () => {
  const item = (key: string, project: string, priority: 0 | 1 | 2 | 3 | 4) => ({ task: { key, priority }, project: { name: project } })
  const items = [item("B-1", "Beta", 0), item("A-1", "Alpha", 3), item("B-2", "Beta", 1), item("A-2", "Alpha", 3)]
  const keys = (sorted: ReadonlyArray<{ task: { key: string } }>) => sorted.map((i) => i.task.key)

  it("Oldest is the queue's own order, Newest is that reversed", () => {
    expect(keys(sortQueue(items, "oldest"))).toEqual(["B-1", "A-1", "B-2", "A-2"])
    expect(keys(sortQueue(items, "newest"))).toEqual(["A-2", "B-2", "A-1", "B-1"])
  })

  it("Project goes by the project's name, ties in the queue's order", () => {
    expect(keys(sortQueue(items, "project"))).toEqual(["A-1", "A-2", "B-1", "B-2"])
  })

  it("Priority puts urgent first and no priority last, ties in the queue's order", () => {
    expect(keys(sortQueue(items, "priority"))).toEqual(["B-2", "A-1", "A-2", "B-1"])
  })

  it("leaves the queue itself alone", () => {
    sortQueue(items, "newest")
    expect(keys(items)).toEqual(["B-1", "A-1", "B-2", "A-2"])
  })
})

describe("rowKey: j and k move between rows like ↓ and ↑", () => {
  it("maps j and k, and leaves other keys as they are", () => {
    expect(rowKey("j")).toBe("ArrowDown")
    expect(rowKey("k")).toBe("ArrowUp")
    expect(rowKey("ArrowDown")).toBe("ArrowDown")
    expect(rowKey("Home")).toBe("Home")
    expect(rowKey("J")).toBe("J")
  })
})

describe("decisionNote: Send back and Approve on the Review page send what's in the comment box (CEL-70)", () => {
  it("the typed text, trimmed, is the note", () => {
    expect(decisionNote("  The poster frame is black.\n")).toBe("The poster frame is black.")
  })

  it("an empty box has no note: Send back asks for one, Approve goes without", () => {
    for (const text of ["", "   ", "\n\t"]) expect(decisionNote(text)).toBeNull()
  })
})

describe("undoable: a decision waits in a window before it is sent (CEL-191)", () => {
  const undoable: DecisionState = { phase: "undoable", decision: "approved" }

  it("a click that may be undone waits, sending nothing; without the window it is pending as before", () => {
    expect(decisionStep(IDLE, { type: "clicked", decision: "approved", undoable: true })).toEqual(undoable)
    expect(decisionStep(IDLE, { type: "clicked", decision: "approved", undoable: false })).toEqual({ phase: "pending", decision: "approved" })
    expect(decisionStep({ phase: "failed", decision: "approved", message: "x" }, { type: "clicked", decision: "sent_back", undoable: true })).toEqual({ phase: "undoable", decision: "sent_back" })
  })

  it("undo puts the row back to idle; the window ending sends it, and the server's answer follows", () => {
    expect(decisionStep(undoable, { type: "undone" })).toEqual(IDLE)
    const sending = decisionStep(undoable, { type: "sent" })
    expect(sending).toEqual({ phase: "sending", decision: "approved" })
    // It waited: the row has said "Approved" for the whole window, so it needn't say it again.
    expect(decisionStep(sending, { type: "taken" })).toEqual({ phase: "decided", decision: "approved", waited: true })
    expect(decisionStep(sending, { type: "refused", message: "Can't reach the Cello server" })).toEqual({ phase: "failed", decision: "approved", message: "Can't reach the Cello server" })
  })

  it("nothing out of turn: a second click, or A pressed again, doesn't decide twice; a sent decision can't be undone", () => {
    expect(decisionStep(undoable, { type: "clicked", decision: "sent_back", undoable: true })).toBe(undoable)
    expect(decisionStep(undoable, { type: "taken" })).toBe(undoable)
    expect(decisionStep(undoable, { type: "refused", message: "x" })).toBe(undoable)
    const sending: DecisionState = { phase: "sending", decision: "approved" }
    expect(decisionStep(sending, { type: "undone" })).toBe(sending)
    expect(decisionStep(sending, { type: "sent" })).toBe(sending)
    expect(decisionStep(sending, { type: "clicked", decision: "approved", undoable: true })).toBe(sending)
    expect(decisionStep(IDLE, { type: "undone" })).toBe(IDLE)
    expect(decisionStep(IDLE, { type: "sent" })).toBe(IDLE)
    const pending: DecisionState = { phase: "pending", decision: "approved" }
    expect(decisionStep(pending, { type: "undone" })).toBe(pending)
  })

  const held = (key: string, at: number, state: DecisionState): Held<string> => ({ key, item: key, at, dropped: false, state })

  it("an undoable or sending row stays in its place, whatever the queue says; undone, it is let go", () => {
    expect(withHeld(["CEL-3", "THAI-2"], (k) => k, [held("CEL-7", 1, undoable)])).toEqual(["CEL-3", "CEL-7", "THAI-2"])
    expect(withHeld(["CEL-3", "THAI-2"], (k) => k, [held("CEL-7", 1, { phase: "sending", decision: "approved" })])).toEqual(["CEL-3", "CEL-7", "THAI-2"])
    expect(holdStep([held("CEL-7", 1, undoable)], "CEL-7", { type: "undone" })).toEqual([])
  })

  it("two rows in their windows at once move on their own", () => {
    const rows = [held("CEL-3", 0, undoable), held("CEL-7", 1, { phase: "undoable", decision: "sent_back" })]
    const afterOne = holdStep(rows, "CEL-3", { type: "undone" })
    expect(afterOne.map((h) => h.key)).toEqual(["CEL-7"])
    expect(holdStep(rows, "CEL-7", { type: "sent" })[0]).toBe(rows[0])
  })
})

describe("decisionStillOpen: a decision made on a packet still stands while that packet is the one waiting (CEL-191)", () => {
  it("the same packet, still waiting: it stands, even if the agent asked a question meanwhile (the task is in Needs input, the packet still waits)", () => {
    expect(decisionStillOpen("r1", { reviewId: "r1", waiting: true })).toBe(true)
  })

  it("decided elsewhere (the side panel, the CLI): there is no open packet, so it doesn't stand", () => {
    expect(decisionStillOpen("r1", { reviewId: null, waiting: true })).toBe(false)
    expect(decisionStillOpen("r1", { reviewId: null, waiting: false })).toBe(false)
  })

  it("the agent handed in a new packet: the decision was about the old one", () => {
    expect(decisionStillOpen("r1", { reviewId: "r2", waiting: true })).toBe(false)
  })

  it("a task in In Review without a packet (by hand): it stands while it still waits with no packet; a packet or a move out ends it", () => {
    expect(decisionStillOpen(null, { reviewId: null, waiting: true })).toBe(true)
    expect(decisionStillOpen(null, { reviewId: "r9", waiting: true })).toBe(false)
    expect(decisionStillOpen(null, { reviewId: null, waiting: false })).toBe(false)
  })
})

describe("overtaken: the rows whose decision waits in its window but doesn't stand any more (CEL-191)", () => {
  const row = (key: string, phase: "undoable" | "sending"): Held<string> => ({ key, item: key, at: 0, dropped: false, state: { phase, decision: "approved" } })

  it("lists the waiting rows the rule rejects, and only those", () => {
    const rows = [row("CEL-3", "undoable"), row("CEL-7", "undoable")]
    expect(overtaken(rows, (item) => item !== "CEL-3")).toEqual(["CEL-3"])
    expect(overtaken(rows, () => true)).toEqual([])
  })

  it("a row already being sent is past asking", () => {
    expect(overtaken([row("CEL-3", "sending")], () => false)).toEqual([])
  })
})

describe("undoTarget: Z takes back the decision made last (CEL-191)", () => {
  const row = (key: string, phase: "undoable" | "sending" | "pending"): Held<string> => ({ key, item: key, at: 0, dropped: false, state: { phase, decision: "approved" } })

  it("the most recently decided of the rows waiting, whichever is open", () => {
    expect(undoTarget([row("CEL-3", "undoable"), row("CEL-7", "undoable"), row("CEL-9", "sending")])).toBe("CEL-7")
  })

  it("none when nothing waits", () => {
    expect(undoTarget([])).toBeNull()
    expect(undoTarget([row("CEL-3", "sending"), row("CEL-4", "pending")])).toBeNull()
  })
})
