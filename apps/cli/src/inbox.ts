// How an agent session reads what reached it (CEL-15): Lucas's comments, Send back notes, his
// answers to the questions it asked on a card and word that he withdrew one by moving the card (CEL-47),
// his reactions (CEL-77), and word that a change of his ended its claim (CEL-46). A comment on a task
// nobody held says it reopened the task for the session, which holds it again (CEL-110).
// `cello inbox`, `cello context` and the Claude Code hook print items the same way, so the agent sees one
// format wherever they arrive. Screenshots in Lucas's answers and comments (CEL-73) are saved to temp
// files first, and the text names the files.
import * as path from "node:path"
import type { Ask, Attachment, Comment, InboxClaimEnded, InboxComment, InboxItem } from "@cello/contract/entities"
import { answerLines, answerScreenshots, screenshotLine } from "./ask.ts"
import { ago, andList } from "./format.ts"

/**
 * The most a delivery may be: Claude Code caps a hook's added context at 10,000 characters
 * (https://code.claude.com/docs/en/hooks), so long comments are cut, pointing at the full text.
 */
export const MAX_DELIVERY = 9_500

/** Where the screenshots in answers and comments were saved: attachment id → local path. */
export type SavedFiles = ReadonlyMap<string, string>

const NO_FILES: SavedFiles = new Map()

/** A screenshot to save, and the file it goes to, relative to the temp folder. */
export interface ScreenshotFile {
  readonly attachment: Attachment
  readonly file: string
}

/** Lucas's answer screenshots: `cello-answers/<ask id>/q1-1.png`, `…/note-1.png`. */
export const askScreenshots = (ask: Ask): ScreenshotFile[] =>
  answerScreenshots(ask).map(({ attachment, fileName }) => ({ attachment, file: path.join("cello-answers", ask.id, fileName) }))

/** A comment's screenshots: `cello-comments/<comment id>/1.png`, `2.webp`, … */
export const commentScreenshots = (comment: Comment): ScreenshotFile[] =>
  (comment.attachments ?? []).map((attachment, i) => ({
    attachment,
    file: path.join("cello-comments", comment.id, `${i + 1}${path.extname(attachment.name).toLowerCase() || ".png"}`),
  }))

/** Every screenshot in what reached the agent: in answers and in comments (a reaction quotes your own comment, so none). */
export const inboxScreenshots = (items: ReadonlyArray<InboxItem>): ScreenshotFile[] =>
  items.flatMap((i) => (i.kind === "answers" ? askScreenshots(i.ask) : isComment(i) ? commentScreenshots(i.comment) : []))

/** A comment or a Send back note: the items to answer on the card. */
const isComment = (item: InboxItem): item is InboxComment => item.kind === "comment" || item.kind === "send_back"

/** Whether a comment's reopen moved the task (Done to In Progress), or only gave the claim back (CEL-110). */
const isMove = (reopened: NonNullable<InboxComment["reopened"]>) => reopened.from !== reopened.to

/** What a comment's reopen did to its task and what's next, for the delivery's last lines (CEL-110). */
const reopenLine = (item: InboxComment & { readonly reopened: NonNullable<InboxComment["reopened"]> }) => {
  const { taskKey: key, author: human, reopened } = item
  const submit = `when the work is done, hand it in with \`cello task submit ${key}\``
  return isMove(reopened)
    ? `${key} was ${reopened.from}: ${human}'s comment reopened it and gave it back to you. It's in ${reopened.to} and claimed by this session again; ${submit}.`
    : `Nobody held ${key}: ${human}'s comment gave it back to you, and it's claimed by this session again (${reopened.to}); ${submit}.`
}

/** What Lucas did that ended the claim (CEL-46), as a sentence about `task`. */
const claimEnd = (item: InboxClaimEnded): string => {
  const task = item.taskKey
  switch (item.cause) {
    case "moved":
      return `moved ${task} to ${item.status}`
    case "edited":
      return `edited ${task}`
    case "labels":
      return `changed the labels of ${task}`
    case "archived":
      return `archived ${task}`
    case "claimed":
      return `took ${task} over`
    case "released":
      return `released your claim on ${task}`
  }
}

/** A comment's words, then a line per screenshot naming the file it was saved to. */
export const commentText = (comment: Comment, files: SavedFiles): string =>
  [comment.body.trim(), ...(comment.attachments ?? []).map((a) => screenshotLine(a, files))].filter((l) => l !== "").join("\n")

const who = (item: InboxItem) => {
  switch (item.kind) {
    case "answers":
      return `${item.author} answered your questions "${item.ask.title}"`
    case "withdrawn":
      return `${item.author} moved it out of Needs input`
    case "send_back":
      return `${item.author} sent it back`
    case "comment":
      if (!item.reopened) return `${item.author} commented`
      return isMove(item.reopened) ? `${item.author} commented while it was ${item.reopened.from}, reopening it` : `${item.author} commented while nobody held it`
    case "reaction":
      return `${item.author} reacted ${item.emoji} to your comment`
    case "claim_ended":
      return `${item.author} ended your claim`
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
    case "claim_ended":
      return `${item.author} ${claimEnd(item)}: your claim ended. Stop working on it.`
    default:
      return commentText(item.comment, files)
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
  const ended = items.filter((i) => i.kind === "claim_ended").length
  const comments = items.length - answers - withdrawn - reactions - ended
  const parts = [
    ...(answers ? [answers === 1 ? "answers to the questions you asked" : `answers to ${answers} asks`] : []),
    ...(withdrawn ? [withdrawn === 1 ? "an ask withdrawn" : `${withdrawn} asks withdrawn`] : []),
    ...(comments ? [comments === 1 ? "a comment" : `${comments} comments`] : []),
    ...(reactions ? [reactions === 1 ? "a reaction" : `${reactions} reactions`] : []),
    ...(ended ? [ended === 1 ? "an ended claim" : `${ended} ended claims`] : []),
  ]
  const human = items[0]?.author ?? "the human"
  if (comments === items.length) {
    // A comment that reopened its task came while the session no longer held it (CEL-110).
    if (items.some((i) => isComment(i) && i.reopened)) {
      return comments === 1 ? "New Cello comment on a task you worked on before, now yours again:" : `${comments} new Cello comments on tasks you claimed or worked on before:`
    }
    return comments === 1 ? "New Cello comment on a task you claimed:" : `${comments} new Cello comments on tasks you claimed:`
  }
  if (reactions === items.length) {
    return reactions === 1 ? `${human} reacted to your comment in Cello:` : `${human} reacted to your comments in Cello (${reactions}):`
  }
  if (ended === items.length) {
    // A task can end twice in one batch (released, claimed again, edited): count the tasks.
    const tasks = unique(items.map((i) => i.taskKey)).length
    return tasks === 1 ? `${human} ended your claim on a task in Cello:` : `${human} ended your claims on ${tasks} tasks in Cello:`
  }
  return `New in Cello for you: ${andList(parts)}:`
}

/**
 * What the agent gets when new items arrive: what they are, the items, and what to do next: answer
 * comments on the card, hand a sent-back task in again, carry on with Lucas's answers, stop working on
 * a task whose claim he ended. At most MAX_DELIVERY characters. `files` says where the screenshots in
 * answers were saved.
 */
export const deliveryText = (items: ReadonlyArray<InboxItem>, now: number, files: SavedFiles = NO_FILES): string => {
  const count = items.length
  const comments = items.filter(isComment)
  const withShots = comments.some((i) => (i.comment.attachments?.length ?? 0) > 0)
  const answered = unique(items.filter((i) => i.kind === "answers").map((i) => i.taskKey))
  const withdrawn = unique(items.filter((i) => i.kind === "withdrawn").map((i) => i.taskKey))
  const sentBack = unique(items.filter((i) => i.kind === "send_back").map((i) => i.taskKey))
  const ended = unique(items.filter((i) => i.kind === "claim_ended").map((i) => i.taskKey))
  const reacted = items.some((i) => i.kind === "reaction")
  // One line per task a comment reopened for the session (CEL-110), the first comment that did.
  const reopenedTasks = comments.flatMap((i) => (i.reopened ? [{ ...i, reopened: i.reopened }] : []))
    .filter((i, n, all) => all.findIndex((j) => j.taskKey === i.taskKey) === n)
  const human = items[0]?.author ?? "the human"
  const tail = [
    ...(comments.length
      ? [`Act on ${comments.length === 1 ? "it" : "them"} now${withShots ? ` (${comments.length === 1 ? "its" : "their"} screenshots are files you can open)` : ""}, then answer on the card: ${answerHint(comments.map((i) => i.taskKey))}, so ${human} sees your reply there.`]
      : []),
    ...reopenedTasks.map(reopenLine),
    ...(sentBack.length
      ? [`For a task ${human} sent back, fix what the note asks, then hand it in again with \`cello task submit ${sentBack[0]}\`${sentBack.length > 1 ? ` (${sentBack.slice(1).join(", ")} the same way)` : ""}.`]
      : []),
    ...(answered.length
      ? [`${answered.join(", ")} ${answered.length === 1 ? "is" : "are"} back in progress: carry on with ${human}'s answers (the screenshots are files you can open). If something is unclear, ask on the card again with \`cello task ask\`.`]
      : []),
    ...(withdrawn.length
      ? [`Your claim on ${withdrawn.join(", ")} ended with the move. Check with \`cello task get ${withdrawn[0]}\`, and ask ${human} on the card before you carry on.`]
      : []),
    ...(reacted ? [`A reaction is ${human}'s quick answer to your comment: take it as their reply; there's no need to answer it on the card.`] : []),
    ...(ended.length
      ? [ended.length === 1
        ? `Stop working on ${ended[0]}: your claim on it ended. See where it stands with \`cello task get ${ended[0]}\`. If you think the work should go on, say so on the card (\`cello task comment ${ended[0]} "…"\`) and leave the decision to ${human}.`
        : `Stop working on ${andList(ended)}: your claims on them ended. See where they stand with \`cello task get ${ended[0]}\`. If you think the work should go on, say so on the card (\`cello task comment ${ended[0]} "…"\`) and leave the decision to ${human}.`]
      : []),
  ]
  const build = (limit?: number) => [headOf(items), "", ...inboxEntries(items, now, limit, files), "", ...tail].join("\n")
  const full = build()
  if (full.length <= MAX_DELIVERY) return full
  // Share what's left after the fixed lines between the items' texts.
  const fixed = build(0).length + count * 120
  return build(Math.max(80, Math.floor((MAX_DELIVERY - fixed) / count))).slice(0, MAX_DELIVERY)
}
