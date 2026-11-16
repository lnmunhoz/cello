// What an agent reads when comments reach it: `cello inbox`, `cello context` and the Claude Code hook
// all print items the same way.
import * as path from "node:path"
import type { Attachment, InboxComment, InboxReaction } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { deliveryText, inboxEntries, inboxScreenshots, MAX_DELIVERY } from "./inbox.ts"

const NOW = 1_800_000_000_000

const item = (overrides: Partial<InboxComment> & { body?: string } = {}): InboxComment => {
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

const screenshot = (id: string, name: string): Attachment => ({
  id, taskId: "task-1", reviewId: null, askId: null, kind: "image", name, url: null, caption: "", mime: "image/png", bytes: 10,
  hasPoster: false, actorId: "human", sessionId: null, createdAt: NOW, deletedAt: null,
})

describe("inboxScreenshots", () => {
  it("names each screenshot in comments and answers by where it's saved under the temp folder", () => {
    const comment = item({ comment: { ...item().comment, id: "c1", attachments: [screenshot("f1", "image.PNG"), screenshot("f2", "drop.webp")] } })
    expect(inboxScreenshots([comment, item({ id: "item-2" })]).map(({ attachment, file }) => [attachment.id, file])).toEqual([
      ["f1", path.join("cello-comments", "c1", "1.png")],
      ["f2", path.join("cello-comments", "c1", "2.webp")],
    ])
  })
})

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

  it("a reaction (CEL-77) quotes the start of the comment on one line, and needs no reply", () => {
    const body = "Built the picker and the chips. Shall I merge it now, or wait for the CEL-73 attachments to land first?\nMore."
    const reaction: InboxReaction = { ...item({ body }), id: "item-9", kind: "reaction", emoji: "👍", createdAt: NOW - 60_000 }
    expect(deliveryText([reaction], NOW)).toBe([
      "Lucas reacted to your comment in Cello:",
      "",
      "CEL-3  Comments reach agents",
      "  Lucas reacted 👍 to your comment, 1m ago",
      "    \"Built the picker and the chips. Shall I merge it now, or wait for the CEL-73 att…\"",
      "",
      "A reaction is Lucas's quick answer to your comment: take it as their reply; there's no need to answer it on the card.",
    ].join("\n"))

    const mixed = deliveryText([item(), reaction, { ...reaction, id: "item-10", emoji: "🎉" }], NOW)
    expect(mixed.split("\n")[0]).toBe("New in Cello for you: a comment and 2 reactions:")
    expect(mixed).toContain("answer on the card: `cello task comment CEL-3 \"…\"`")
    expect(mixed).toContain("A reaction is Lucas's quick answer to your comment")
  })

  it("lists a comment's screenshots under its text, as the files they were saved to, and says they're files to open (CEL-73)", () => {
    const shots = [screenshot("f1", "image.png"), screenshot("f2", "drop.webp")]
    const files = new Map([["f1", "/tmp/cello-comments/c1/1.png"]])
    expect(deliveryText([item({ comment: { ...item().comment, body: "Like this", attachments: shots } })], NOW, files)).toBe([
      "New Cello comment on a task you claimed:",
      "",
      "CEL-3  Comments reach agents",
      "  Lucas commented, 2m ago",
      "    Like this",
      "    Screenshot: /tmp/cello-comments/c1/1.png",
      // One that couldn't be saved shows where the server serves it.
      "    Screenshot: /attachments/f2",
      "",
      "Act on it now (its screenshots are files you can open), then answer on the card: `cello task comment CEL-3 \"…\"` (or `--body-file -` for markdown), so Lucas sees your reply there.",
    ].join("\n"))
    // A screenshot with no words: just the screenshot.
    expect(inboxEntries([item({ comment: { ...item().comment, body: "", attachments: [shots[0]!] } })], NOW, undefined, files)).toEqual([
      "CEL-3  Comments reach agents",
      "  Lucas commented, 2m ago",
      "    Screenshot: /tmp/cello-comments/c1/1.png",
    ])
  })

  it("stays under Claude Code's 10,000-character limit for hook context, pointing at the full text", () => {
    const text = deliveryText([item({ body: "x".repeat(20_000) })], NOW)
    expect(text.length).toBeLessThanOrEqual(MAX_DELIVERY)
    expect(text).toContain("(cut short: read it all with `cello task get CEL-3`)")
    expect(text).toContain("answer on the card")
  })
})
