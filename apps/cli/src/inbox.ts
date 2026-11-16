// How an agent session reads what reached it (CEL-15): Lucas's comments, Send back notes, his
// answers to the questions it asked on a card and word that he withdrew one by moving the card (CEL-47).
// `cello inbox`, `cello context` and the Claude Code hook print items the same way, so the agent sees one
// format wherever they arrive.
import type { InboxItem } from "@cello/contract/entities"
import { answerLines } from "./ask.ts"
import { ago, andList } from "./format.ts"

/**
 * The most a delivery may be: Claude Code caps a hook's added context at 10,000 characters
 * (https://code.claude.com/docs/en/hooks), so long comments are cut, pointing at the full text.
 */
export const MAX_DELIVERY = 9_500

/** Where the screenshots in answers were saved: attachment id → local path. */
export type SavedFiles = ReadonlyMap<string, string>

const NO_FILES: SavedFiles = new Map()

const who = (item: InboxItem) => {
  switch (item.kind) {
    case "answers":
      return `${item.author} answered your questions "${item.ask.title}"`
    case "withdrawn":
      return `${item.author} moved it out of Needs input`
    case "send_back":
      return `${item.author} sent it back`
    case "comment":
      return `${item.author} commented`
    case "reaction":
      return `${item.author} reacted ${item.emoji} to your comment`
  }
}

/** How much of the comment a reaction quotes. */
export const REACTION_QUOTE = 80

/** The start of a comment on one line: what a reaction was to (here and in `cello task react`). */
export const commentStart = (body: string) => {
  const line = body.replace(/\s+/g, " ").trim()
  return line.length <= REACTION_QUOTE ? line : `${line.slice(0, REACTION_QUOTE).trimEnd()}…`
}

const quoteOf = (body: string) => `"${commentStart(body)}"`

const textOf = (item: InboxItem, files: SavedFiles) => {
  switch (item.kind) {
    case "answers":
      return answerLines(item.ask, files).join("\n")
    case "withdrawn":
      return `${item.author} moved ${item.taskKey} to ${item.status}; your ask "${item.ask.title}" was withdrawn.`
    case "reaction":
      return quoteOf(item.comment.body)
    default:
      return item.comment.body.trim()
  }
}

const readAll = (item: InboxItem) => item.kind === "answers" ? `cello task answers ${item.taskKey}` : `cello task get ${item.taskKey}`

/** One item: its task, who wrote it and when, then its text, indented. `limit` cuts a long text. */
const entry = (item: InboxItem, now: number, files: SavedFiles, limit = Infinity): string[] => {
  const body = textOf(item, files)
  const text = body.length <= limit ? body : `${body.slice(0, limit).trimEnd()}…\n(cut short: read it all with \`${readAll(item)}\`)`
  return [`${item.taskKey}  ${item.taskTitle}`, `  ${who(item)}, ${ago(item.createdAt, now)}`, ...text.split("\n").map((l) => (l === "" ? "" : `    ${l}`))]
}

/** Items one after another, a blank line between them. */
export const inboxEntries = (items: ReadonlyArray<InboxItem>, now: number, limit?: number, files: SavedFiles = NO_FILES): string[] =>
  items.flatMap((item, i) => [...(i === 0 ? [] : [""]), ...entry(item, now, files, limit)])

const unique = (keys: ReadonlyArray<string>) => [...new Set(keys)]

/** "`cello task comment CEL-3 "…"`", plus the other tasks to answer on. */
const answerHint = (keys: ReadonlyArray<string>) => {
  const [first, ...others] = unique(keys)
  const command = `\`cello task comment ${first} "…"\``
  return others.length === 0
    ? `${command} (or \`--body-file -\` for markdown)`
    : `${command} (${others.join(", ")} the same way; \`--body-file -\` for markdown)`
}

const headOf = (items: ReadonlyArray<InboxItem>) => {
  const answers = items.filter((i) => i.kind === "answers").length
  const withdrawn = items.filter((i) => i.kind === "withdrawn").length
  const reactions = items.filter((i) => i.kind === "reaction").length
  const comments = items.length - answers - withdrawn - reactions
  const parts = [
    ...(answers ? [answers === 1 ? "answers to the questions you asked" : `answers to ${answers} asks`] : []),
    ...(withdrawn ? [withdrawn === 1 ? "an ask withdrawn" : `${withdrawn} asks withdrawn`] : []),
    ...(comments ? [comments === 1 ? "a comment" : `${comments} comments`] : []),
    ...(reactions ? [reactions === 1 ? "a reaction" : `${reactions} reactions`] : []),
  ]
  if (answers + withdrawn + reactions === 0) return comments === 1 ? "New Cello comment on a task you claimed:" : `${comments} new Cello comments on tasks you claimed:`
  if (reactions === items.length) {
    const human = items[0]!.author
    return reactions === 1 ? `${human} reacted to your comment in Cello:` : `${human} reacted to your comments in Cello (${reactions}):`
  }
  return `New in Cello for you: ${andList(parts)}:`
}

/**
 * What the agent gets when new items arrive: what they are, the items, and what to do next: answer
 * comments on the card, hand a sent-back task in again, carry on with Lucas's answers. At most
 * MAX_DELIVERY characters. `files` says where the screenshots in answers were saved.
 */
export const deliveryText = (items: ReadonlyArray<InboxItem>, now: number, files: SavedFiles = NO_FILES): string => {
  const count = items.length
  const comments = items.filter((i) => i.kind === "comment" || i.kind === "send_back")
  const answered = unique(items.filter((i) => i.kind === "answers").map((i) => i.taskKey))
  const withdrawn = unique(items.filter((i) => i.kind === "withdrawn").map((i) => i.taskKey))
  const sentBack = unique(items.filter((i) => i.kind === "send_back").map((i) => i.taskKey))
  const reacted = items.some((i) => i.kind === "reaction")
  const human = items[0]?.author ?? "Lucas"
  const tail = [
    ...(comments.length
      ? [`Act on ${comments.length === 1 ? "it" : "them"} now, then answer on the card: ${answerHint(comments.map((i) => i.taskKey))}, so ${human} sees your reply there.`]
      : []),
    ...(sentBack.length
      ? [`For a task ${human} sent back, fix what the note asks, then hand it in again with \`cello task submit ${sentBack[0]}\`${sentBack.length > 1 ? ` (${sentBack.slice(1).join(", ")} the same way)` : ""}.`]
      : []),
    ...(answered.length
      ? [`${answered.join(", ")} ${answered.length === 1 ? "is" : "are"} back in progress: carry on with ${human}'s answers (the screenshots are files you can open). If something is unclear, ask on the card again with \`cello task ask\`.`]
      : []),
    ...(withdrawn.length
      ? [`Your claim on ${withdrawn.join(", ")} ended with the move. Check with \`cello task get ${withdrawn[0]}\`, and ask ${human} on the card before you carry on.`]
      : []),
    ...(reacted ? [`A reaction is ${human}'s quick answer to your comment: take it as his reply; there's no need to answer it on the card.`] : []),
  ]
  const build = (limit?: number) => [headOf(items), "", ...inboxEntries(items, now, limit, files), "", ...tail].join("\n")
  const full = build()
  if (full.length <= MAX_DELIVERY) return full
  // Share what's left after the fixed lines between the items' texts.
  const fixed = build(0).length + count * 120
  return build(Math.max(80, Math.floor((MAX_DELIVERY - fixed) / count))).slice(0, MAX_DELIVERY)
}
