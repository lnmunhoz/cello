// Comments load per task (comment.list); this keeps a loaded list current from the event stream.
import type { Comment } from "@cello/contract/entities"
import type { CelloEvent } from "@cello/contract/events"

export const applyCommentEvents = (
  comments: ReadonlyArray<Comment>,
  taskId: string,
  events: ReadonlyArray<CelloEvent>,
): ReadonlyArray<Comment> => {
  let next = comments
  for (const e of events) {
    switch (e.type) {
      case "comment.added":
        if (e.comment.taskId === taskId && !next.some((c) => c.id === e.comment.id)) next = [...next, e.comment]
        break
      case "comment.edited":
        if (next.some((c) => c.id === e.id)) next = next.map((c) => (c.id === e.id ? { ...c, ...e.after, updatedAt: e.ts } : c))
        break
      case "comment.deleted":
        if (next.some((c) => c.id === e.id)) next = next.map((c) => (c.id === e.id ? { ...c, deletedAt: e.ts } : c))
        break
    }
  }
  return next
}
