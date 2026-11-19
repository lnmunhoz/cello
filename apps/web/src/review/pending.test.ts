import { describe, expect, it } from "vitest"
import { judgePending, MAX_AGE_MS, parsePending, type PendingDecision, pendingStorageKey, serializePending } from "./pending.ts"

const record: PendingDecision = {
  taskId: "t-1",
  taskKey: "CEL-12",
  reviewId: "r-1",
  decision: "approved",
  note: "Ship it.",
  attachmentIds: ["a-1", "a-2"],
  clickedAt: 1_000_000,
}

describe("the record of a decision waiting in its window (CEL-191)", () => {
  it("is kept per task, so two tabs never overwrite each other's", () => {
    expect(pendingStorageKey("CEL-12")).toBe("cello:review-pending:CEL-12")
    expect(pendingStorageKey("CEL-12")).not.toBe(pendingStorageKey("CEL-13"))
  })

  it("writes back what it reads", () => {
    expect(parsePending(serializePending(record))).toEqual(record)
    const byHand = { ...record, reviewId: null, note: null, attachmentIds: [] }
    expect(parsePending(serializePending(byHand))).toEqual(byHand)
    expect(parsePending(serializePending({ ...record, decision: "sent_back" }))).toEqual({ ...record, decision: "sent_back" })
  })

  it("garbage is no record, never an error: nothing is sent from what can't be read", () => {
    for (const bad of [null, "", "not json", "null", "[]", "42", '"text"', "{}"]) expect(parsePending(bad)).toBeNull()
  })

  it("a record missing a field, or with a wrong one, is no record", () => {
    const good = JSON.parse(serializePending(record)) as Record<string, unknown>
    for (const [field, value] of [
      ["v", 2],
      ["taskId", 7],
      ["taskId", ""],
      ["taskKey", null],
      ["reviewId", 7],
      ["decision", "rejected"],
      ["note", 5],
      ["attachmentIds", "a-1"],
      ["attachmentIds", [1]],
      ["clickedAt", "yesterday"],
      ["clickedAt", Number.NaN],
    ] as const) {
      expect(parsePending(JSON.stringify({ ...good, [field]: value }))).toBeNull()
    }
    const { decision: _, ...without } = good
    expect(parsePending(JSON.stringify(without))).toBeNull()
  })

  it("a Send back without its note is no record: the command would be refused", () => {
    expect(parsePending(serializePending({ ...record, decision: "sent_back", note: null }))).toBeNull()
    expect(parsePending(serializePending({ ...record, decision: "sent_back", note: "  " }))).toBeNull()
    expect(parsePending(serializePending({ ...record, decision: "approved", note: null }))).not.toBeNull()
  })

  it("extra fields are ignored, not sent", () => {
    const parsed = parsePending(JSON.stringify({ ...JSON.parse(serializePending(record)), command: "task.delete" }))
    expect(parsed).toEqual(record)
  })
})

describe("judgePending: what to do, on the next load, with a decision recorded before the page closed (CEL-191)", () => {
  const now = record.clickedAt + 60_000
  const same = { reviewId: "r-1", waiting: true }

  it("the packet it was made on still waits: send it at once, no new window", () => {
    expect(judgePending(record, now, same)).toEqual({ kind: "send" })
  })

  it("the packet was decided meanwhile (the page's own send got through, or another place decided): drop it, and say so", () => {
    expect(judgePending(record, now, { reviewId: null, waiting: true })).toEqual({ kind: "drop", reason: "decided" })
    expect(judgePending(record, now, { reviewId: null, waiting: false })).toEqual({ kind: "drop", reason: "decided" })
  })

  it("the agent handed in a new packet meanwhile: drop it, the old one is not what he'd approve now", () => {
    expect(judgePending(record, now, { reviewId: "r-2", waiting: true })).toEqual({ kind: "drop", reason: "decided" })
  })

  it("a packet whose task is gone from the board (another workspace, deleted) is left for a later load, not dropped or sent", () => {
    expect(judgePending(record, now, null)).toEqual({ kind: "later" })
  })

  it("a record older than a day is dropped: nobody means an approval from last week", () => {
    expect(judgePending(record, record.clickedAt + MAX_AGE_MS - 1, same)).toEqual({ kind: "send" })
    expect(judgePending(record, record.clickedAt + MAX_AGE_MS + 1, same)).toEqual({ kind: "drop", reason: "old" })
    expect(judgePending(record, record.clickedAt + MAX_AGE_MS + 1, null)).toEqual({ kind: "drop", reason: "old" })
  })

  it("a task in In Review without a packet: it stands while it still waits without one", () => {
    const byHand = { ...record, reviewId: null }
    expect(judgePending(byHand, now, { reviewId: null, waiting: true })).toEqual({ kind: "send" })
    expect(judgePending(byHand, now, { reviewId: "r-9", waiting: true })).toEqual({ kind: "drop", reason: "decided" })
    expect(judgePending(byHand, now, { reviewId: null, waiting: false })).toEqual({ kind: "drop", reason: "decided" })
  })

  it("a clock set back (a record from the future) is not old", () => {
    expect(judgePending(record, record.clickedAt - 5 * 60_000, same)).toEqual({ kind: "send" })
  })
})
