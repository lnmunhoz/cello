// What an agent reads when comments reach it: `cello inbox`, `cello context` and the Claude Code hook
// all print items the same way.
import * as path from "node:path"
import type { Attachment, InboxApproved, InboxClaimEnded, InboxComment, InboxReaction } from "@cello/contract/entities"
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

// CEL-46: Lucas ending the session's claim reaches it like a comment, and tells it to stop.
describe("a claim Lucas ended", () => {
  const ended = (overrides: Partial<InboxClaimEnded> = {}): InboxClaimEnded => ({
    id: "item-20",
    kind: "claim_ended",
    taskId: "task-40",
    taskKey: "CEL-40",
    taskTitle: "Board filters",
    author: "Lucas",
    cause: "moved",
    status: "Todo",
    createdAt: NOW - 60_000,
    readAt: null,
    ...overrides,
  })

  it("says what he did and that the claim ended, then tells the agent to stop", () => {
    expect(deliveryText([ended()], NOW)).toBe([
      "Lucas ended your claim on a task in Cello:",
      "",
      "CEL-40  Board filters",
      "  Lucas ended your claim, 1m ago",
      "    Lucas moved CEL-40 to Todo: your claim ended. Stop working on it.",
      "",
      "Stop working on CEL-40: your claim on it ended. See where it stands with `cello task get CEL-40`. If you think the work should go on, say so on the card (`cello task comment CEL-40 \"…\"`) and leave the decision to Lucas.",
    ].join("\n"))
  })

  it("names each way he can end it", () => {
    const said = (overrides: Partial<InboxClaimEnded>) => inboxEntries([ended(overrides)], NOW)[2]!.trim()
    expect(said({ status: "Canceled" })).toBe("Lucas moved CEL-40 to Canceled: your claim ended. Stop working on it.")
    expect(said({ status: "Backlog" })).toBe("Lucas moved CEL-40 to Backlog: your claim ended. Stop working on it.")
    expect(said({ cause: "edited", status: "In Progress" })).toBe("Lucas edited CEL-40: your claim ended. Stop working on it.")
    expect(said({ cause: "labels", status: "In Progress" })).toBe("Lucas changed the labels of CEL-40: your claim ended. Stop working on it.")
    expect(said({ cause: "archived", status: "In Progress" })).toBe("Lucas archived CEL-40: your claim ended. Stop working on it.")
    expect(said({ cause: "claimed", status: "In Progress" })).toBe("Lucas took CEL-40 over: your claim ended. Stop working on it.")
    expect(said({ cause: "released", status: "In Progress" })).toBe("Lucas released your claim on CEL-40: your claim ended. Stop working on it.")
  })

  it("with other items: counted in the first line, and a line on stopping after what to do with the rest", () => {
    const text = deliveryText([item(), ended(), ended({ id: "item-21", taskKey: "CEL-41", cause: "archived" })], NOW)
    expect(text.split("\n")[0]).toBe("New in Cello for you: a comment and 2 ended claims:")
    expect(text).toContain("answer on the card: `cello task comment CEL-3 \"…\"`")
    expect(text).toContain("Stop working on CEL-40 and CEL-41: your claims on them ended. See where they stand with `cello task get CEL-40`.")
    expect(inboxScreenshots([ended()])).toEqual([])
  })

  it("counts tasks, not notices: two ended claims on one task (released, claimed again, edited) are one task to stop", () => {
    const text = deliveryText([ended({ cause: "released" }), ended({ id: "item-21", cause: "edited" })], NOW)
    expect(text.split("\n")[0]).toBe("Lucas ended your claim on a task in Cello:")
    expect(text).toContain("Stop working on CEL-40: your claim on it ended.")
    const two = deliveryText([ended(), ended({ id: "item-21", taskKey: "CEL-41", cause: "archived" })], NOW)
    expect(two.split("\n")[0]).toBe("Lucas ended your claims on 2 tasks in Cello:")
  })
})

// CEL-110: a comment on a task nobody held reopened it for this session, which holds it again.
describe("a comment that reopened its task", () => {
  const reopened = (from: string, to: string, overrides: Partial<InboxComment> = {}) =>
    item({ taskKey: "CEL-94", taskTitle: "The setup video", body: "Let's add the instructional video to the repo readme", reopened: { from, to }, ...overrides })

  it("says the comment reopened the task, that it's this session's again, and how to hand it in when done", () => {
    expect(deliveryText([reopened("Done", "In Progress")], NOW)).toBe([
      "New Cello comment on a task you worked on before, now yours again:",
      "",
      "CEL-94  The setup video",
      "  Lucas commented while it was Done, reopening it, 2m ago",
      "    Let's add the instructional video to the repo readme",
      "",
      "Act on it now, then answer on the card: `cello task comment CEL-94 \"…\"` (or `--body-file -` for markdown), so Lucas sees your reply there.",
      "CEL-94 was Done: Lucas's comment reopened it and gave it back to you. It's in In Progress and claimed by this session again; when the work is done, hand it in with `cello task submit CEL-94`.",
    ].join("\n"))
  })

  it("a task that stayed where it was (released, still In Progress) was given back, not reopened", () => {
    const text = deliveryText([reopened("In Progress", "In Progress")], NOW)
    expect(text).toContain("  Lucas commented while nobody held it, 2m ago")
    expect(text).toContain(
      "Nobody held CEL-94: Lucas's comment gave it back to you, and it's claimed by this session again (In Progress); when the work is done, hand it in with `cello task submit CEL-94`.",
    )
  })

  it("with other comments: one first line for all, and a reopen line for each reopened task", () => {
    const text = deliveryText([item(), reopened("Done", "In Progress"), reopened("Canceled", "In Progress", { id: "item-3", taskKey: "CEL-95" })], NOW)
    expect(text.split("\n")[0]).toBe("3 new Cello comments on tasks you claimed or worked on before:")
    expect(text).toContain("CEL-94 was Done: Lucas's comment reopened it")
    expect(text).toContain("CEL-95 was Canceled: Lucas's comment reopened it")
  })
})

// CEL-143: in a project that merges after approval, Lucas's Approve reaches the session holding the claim
// and tells it to merge now, then finish with `cello task done`.
describe("an approval to merge", () => {
  const approved = (overrides: Partial<InboxApproved> = {}): InboxApproved => ({
    id: "item-30",
    kind: "approved",
    taskId: "task-143",
    taskKey: "CEL-143",
    taskTitle: "Merge after I approve",
    author: "Lucas",
    note: null,
    createdAt: NOW - 60_000,
    readAt: null,
    ...overrides,
  })

  it("says he approved it and to merge it now, then `cello task done`", () => {
    expect(deliveryText([approved()], NOW)).toBe([
      "Lucas approved a task in Cello: merge it now.",
      "",
      "CEL-143  Merge after I approve",
      "  Lucas approved it, 1m ago",
      "    Lucas approved CEL-143: merge it now, then `cello task done CEL-143`.",
      "",
      "Merge and deploy CEL-143 the way this project does (its AGENTS.md says how), then finish it with `cello task done CEL-143`: that moves it to Done and ends your claim. " +
        "If the merge fails, say so on the card (`cello task stage CEL-143 fixing`, then `cello task comment CEL-143 \"…\"`) and leave it to Lucas, who can send it back.",
    ].join("\n"))
    expect(inboxScreenshots([approved()])).toEqual([])
  })

  it("carries his approval note under it", () => {
    expect(inboxEntries([approved({ note: "Ship it, and watch the migration" })], NOW).slice(2)).toEqual([
      "    Lucas approved CEL-143: merge it now, then `cello task done CEL-143`.",
      "    Ship it, and watch the migration",
    ])
  })

  it("with other items: counted in the first line; two approvals name both tasks", () => {
    const text = deliveryText([item(), approved()], NOW)
    expect(text.split("\n")[0]).toBe("New in Cello for you: a comment and an approval to merge:")
    expect(text).toContain("then finish it with `cello task done CEL-143`")
    const two = deliveryText([approved(), approved({ id: "item-31", taskKey: "CEL-144" })], NOW)
    expect(two.split("\n")[0]).toBe("Lucas approved 2 tasks in Cello: merge them now.")
    expect(two).toContain("Merge and deploy CEL-143 and CEL-144 the way this project does (its AGENTS.md says how), then finish each with `cello task done CEL-143` (CEL-144 the same way)")
  })
})
