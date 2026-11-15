// What the task panel puts on the clipboard (CEL-67): the key alone, or the task as a message for an
// agent, so Lucas can paste a card into a session without retyping it.
import type { Task } from "@cello/contract/entities"

/**
 * Copies the key, while a task is open (Linear's key for "copy ID"). "Copy for an agent" has none:
 * shortcuts match punctuation by the character typed, so ⌘⇧. arrives as ">" (and differs by keyboard
 * layout), and the free ⌘⇧ and ⌘⌥ letters are the browser's (⌘⇧C, ⌘⌥C open DevTools in Chrome).
 */
export const COPY_KEY_SHORTCUT = "mod+."

/**
 * The task as markdown for an agent: `KEY: title`, the description as written, then the command that
 * reads the whole card. A blank description leaves just the first and last lines.
 */
export const taskForAgent = (task: Pick<Task, "key" | "title" | "description">): string => {
  // Blank lines around it go; the first line's indent stays (an indented code block).
  const description = task.description.replace(/^(\s*\n)+/, "").trimEnd()
  return [`${task.key}: ${task.title}`, ...(description ? [description] : []), `Full card, comments and history: cello task get ${task.key}`].join("\n\n")
}
