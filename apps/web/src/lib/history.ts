// One plain line per history event, for the task panel.
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { CelloEvent } from "@cello/contract/events"

const FIELD_NAMES: Record<string, string> = { title: "title", description: "description", priority: "priority", dueDate: "due date", parentId: "parent" }

const list = (words: string[]) => (words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`)

export const describeEvent = (e: CelloEvent, state: BoardState): string => {
  const who = state.actors[e.actorId]?.name ?? "Someone"
  const status = (id: string) => state.statuses[id]?.name ?? "another status"
  const label = (id: string) => state.labels[id]?.name ?? "a label"
  switch (e.type) {
    case "task.created":
      return `${who} created the task`
    case "task.updated":
      return `${who} changed the ${list(Object.keys(e.after).map((k) => FIELD_NAMES[k] ?? k))}`
    case "task.moved":
      return e.from.statusId === e.to.statusId
        ? `${who} reordered it in ${status(e.to.statusId)}`
        : `${who} moved it from ${status(e.from.statusId)} to ${status(e.to.statusId)}`
    case "task.labels_changed": {
      const parts = [
        ...(e.added.length ? [`added ${list(e.added.map(label))}`] : []),
        ...(e.removed.length ? [`removed ${list(e.removed.map(label))}`] : []),
      ]
      return `${who} ${parts.join(" and ")}`
    }
    case "task.archived":
      return `${who} archived it`
    case "task.unarchived":
      return `${who} restored it`
    case "comment.added":
      return `${who} commented`
    case "comment.edited":
      return `${who} edited a comment`
    case "comment.deleted":
      return `${who} deleted a comment`
    default:
      return `${who} changed it`
  }
}
