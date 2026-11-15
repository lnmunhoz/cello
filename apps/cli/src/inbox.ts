// How an agent session reads the comments that reached it (CEL-15). `cello inbox`, `cello context` and
// the Claude Code hook print items the same way, so the agent sees one format wherever they arrive.
import type { InboxItem } from "@cello/contract/entities"
import { ago } from "./format.ts"

/**
 * The most a delivery may be: Claude Code caps a hook's added context at 10,000 characters
 * (https://code.claude.com/docs/en/hooks), so long comments are cut, pointing at the full text.
 */
export const MAX_DELIVERY = 9_500

const who = (item: InboxItem) => item.kind === "send_back" ? `${item.author} sent it back` : `${item.author} commented`

/** One item: its task, who wrote it and when, then its text, indented. `limit` cuts a long text. */
const entry = (item: InboxItem, now: number, limit = Infinity): string[] => {
  const body = item.comment.body.trim()
  const text = body.length <= limit
    ? body
    : `${body.slice(0, limit).trimEnd()}…\n(cut short: read it all with \`cello task get ${item.taskKey}\`)`
  return [`${item.taskKey}  ${item.taskTitle}`, `  ${who(item)}, ${ago(item.createdAt, now)}`, ...text.split("\n").map((l) => `    ${l}`)]
}

/** Items one after another, a blank line between them. */
export const inboxEntries = (items: ReadonlyArray<InboxItem>, now: number, limit?: number): string[] =>
  items.flatMap((item, i) => [...(i === 0 ? [] : [""]), ...entry(item, now, limit)])

const unique = (keys: ReadonlyArray<string>) => [...new Set(keys)]

/** "`cello task comment CEL-3 "…"`", plus the other tasks to answer on. */
const answerHint = (items: ReadonlyArray<InboxItem>) => {
  const [first, ...others] = unique(items.map((i) => i.taskKey))
  const command = `\`cello task comment ${first} "…"\``
  return others.length === 0
    ? `${command} (or \`--body-file -\` for markdown)`
    : `${command} (${others.join(", ")} the same way; \`--body-file -\` for markdown)`
}

/**
 * What the agent gets when new comments arrive: what they are, the comments, and how to answer on the
 * card (and, for a task Lucas sent back, how to hand it in again). At most MAX_DELIVERY characters.
 */
export const deliveryText = (items: ReadonlyArray<InboxItem>, now: number): string => {
  const count = items.length
  const head = count === 1 ? "New Cello comment on a task you claimed:" : `${count} new Cello comments on tasks you claimed:`
  const sentBack = unique(items.filter((i) => i.kind === "send_back").map((i) => i.taskKey))
  const human = items.find((i) => i.kind === "send_back")?.author ?? "Lucas"
  const author = items[0]?.author ?? "Lucas"
  const tail = [
    `Act on ${count === 1 ? "it" : "them"} now, then answer on the card: ${answerHint(items)}, so ${author} sees your reply there.`,
    ...(sentBack.length
      ? [`For a task ${human} sent back, fix what the note asks, then hand it in again with \`cello task submit ${sentBack[0]}\`${sentBack.length > 1 ? ` (${sentBack.slice(1).join(", ")} the same way)` : ""}.`]
      : []),
  ]
  const build = (limit?: number) => [head, "", ...inboxEntries(items, now, limit), "", ...tail].join("\n")
  const full = build()
  if (full.length <= MAX_DELIVERY) return full
  // Share what's left after the fixed lines between the comments' texts.
  const fixed = build(0).length + count * 120
  return build(Math.max(80, Math.floor((MAX_DELIVERY - fixed) / count))).slice(0, MAX_DELIVERY)
}
