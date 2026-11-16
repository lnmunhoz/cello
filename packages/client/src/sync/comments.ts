// Comments load per task (comment.list), with their reactions and receipts; this keeps a loaded list current from the event stream.
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
      // The session it went to took it (CEL-76): the receipt reads Delivered.
      case "comment.delivered":
        next = next.map((c) =>
          c.id === e.commentId ? { ...c, delivery: { sessionId: e.session, readAt: e.ts, via: e.via } } : c
        )
        break
      // Emoji reactions (CEL-77): the comment's list gains or loses one.
      case "reaction.added": {
        const { reaction } = e
        next = next.map((c) =>
          c.id === reaction.commentId && !(c.reactions ?? []).some((r) => r.id === reaction.id)
            ? { ...c, reactions: [...(c.reactions ?? []), reaction] }
            : c
        )
        break
      }
      case "reaction.removed": {
        const { reaction } = e
        next = next.map((c) =>
          c.id === reaction.commentId && (c.reactions ?? []).some((r) => r.id === reaction.id)
            ? { ...c, reactions: (c.reactions ?? []).filter((r) => r.id !== reaction.id) }
            : c
        )
        break
      }
    }
  }
  return next
}
