// What an agent reads when comments reach it: `cello inbox`, `cello context` and the Claude Code hook
// all print items the same way.
import type { InboxItem } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { deliveryText, inboxEntries, MAX_DELIVERY } from "./inbox.ts"

const NOW = 1_800_000_000_000

const item = (overrides: Partial<InboxItem> & { body?: string } = {}): InboxItem => {
  const { body = "Also handle the empty state.", ...rest } = overrides
  return {
    id: "item-1",
    kind: "comment",
    taskId: "task-1",
    taskKey: "CEL-3",
    taskTitle: "Comments reach agents",
    comment: { id: "c1", taskId: "task-1", body, actorId: "human", sessionId: null, createdAt: NOW - 120_000, updatedAt: NOW - 120_000, deletedAt: null },
    author: "Lucas",
    createdAt: NOW - 120_000,
    readAt: null,
    ...rest,
  }
}

describe("inboxEntries", () => {
  it("prints each item under its task, who wrote it and when, with the text indented", () => {
    expect(inboxEntries([
      item({ body: "Line one\nhttps://example.com/spec" }),
      item({ id: "item-2", kind: "send_back", body: "The video is missing.", createdAt: NOW - 1000 }),
    ], NOW)).toEqual([
      "CEL-3  Comments reach agents",
      "  Lucas commented, 2m ago",
      "    Line one",
      "    https://example.com/spec",
      "",
      "CEL-3  Comments reach agents",
      "  Lucas sent it back, just now",
      "    The video is missing.",
    ])
  })
})

describe("deliveryText", () => {
  it("says what arrived, shows it, and says how to answer on the card", () => {
    expect(deliveryText([item()], NOW)).toBe([
      "New Cello comment on a task you claimed:",
      "",
      "CEL-3  Comments reach agents",
      "  Lucas commented, 2m ago",
      "    Also handle the empty state.",
      "",
      "Act on it now, then answer on the card: `cello task comment CEL-3 \"…\"` (or `--body-file -` for markdown), so Lucas sees your reply there.",
    ].join("\n"))
  })

  it("names every task to answer on, and how to hand a sent-back task in again", () => {
    const text = deliveryText([
      item({ kind: "send_back", body: "Missing the video" }),
      item({ id: "item-2", taskKey: "CEL-4", taskTitle: "Backups", body: "Thanks" }),
    ], NOW)
    expect(text.split("\n")[0]).toBe("2 new Cello comments on tasks you claimed:")
    expect(text).toContain("answer on the card: `cello task comment CEL-3 \"…\"` (CEL-4 the same way; `--body-file -` for markdown)")
    expect(text).toContain("For a task Lucas sent back, fix what the note asks, then hand it in again with `cello task submit CEL-3`.")
  })

  it("stays under Claude Code's 10,000-character limit for hook context, pointing at the full text", () => {
    const text = deliveryText([item({ body: "x".repeat(20_000) })], NOW)
    expect(text.length).toBeLessThanOrEqual(MAX_DELIVERY)
    expect(text).toContain("(cut short: read it all with `cello task get CEL-3`)")
    expect(text).toContain("answer on the card")
  })
})
