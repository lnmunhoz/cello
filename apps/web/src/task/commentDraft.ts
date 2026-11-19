// A comment while Lucas writes it (CEL-73): its words and the screenshots he pasted or dropped, kept on
// this device per task until he sends, so a reload or a closed panel loses nothing. The task panel and
// the Review page show the same task's box from the same draft. The screenshots are uploaded as soon
// as they land; the draft keeps their attachments.
import type { Attachment } from "@cello/contract/entities"
import { readStored, useStored, writeStored } from "../lib/storage.ts"
import { isRecord } from "@cello/domain/record"
import { attachmentsIn } from "../screenshots/screenshots.ts"

export interface CommentDraft {
  readonly body: string
  readonly attachments: ReadonlyArray<Attachment>
}

export const EMPTY_COMMENT: CommentDraft = { body: "", attachments: [] }

/** Where a task's comment draft is kept. */
export const commentDraftKey = (taskId: string): string => `cello:comment-draft:${taskId}`

/** A saved draft; empty when there's none or it can't be read. */
export const readCommentDraft = (raw: string | null): CommentDraft => {
  if (raw === null || raw === "") return EMPTY_COMMENT
  try {
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)) return EMPTY_COMMENT
    const { body, attachments } = value
    return { body: typeof body === "string" ? body : "", attachments: attachmentsIn(attachments) }
  } catch {
    return EMPTY_COMMENT
  }
}

export const addScreenshot = (draft: CommentDraft, attachment: Attachment): CommentDraft => ({ ...draft, attachments: [...draft.attachments, attachment] })

export const removeScreenshot = (draft: CommentDraft, attachmentId: string): CommentDraft => ({
  ...draft,
  attachments: draft.attachments.filter((a) => a.id !== attachmentId),
})

/** What `comment.add` takes, or null when there's nothing to send (no words, no screenshot). */
export const toComment = (draft: CommentDraft): { readonly body: string; readonly attachmentIds: string[] } | null => {
  const body = draft.body.trim()
  if (body === "" && draft.attachments.length === 0) return null
  return { body, attachmentIds: draft.attachments.map((a) => a.id) }
}

/**
 * A task's comment draft, and how to change or clear it. Every box showing the task's draft re-renders
 * on a change; a change reads the stored draft first, so an upload finishing late adds to what's there now.
 */
export const useCommentDraft = (taskId: string) => {
  const key = commentDraftKey(taskId)
  const draft = readCommentDraft(useStored(key))
  const update = (change: (d: CommentDraft) => CommentDraft) => writeStored(key, JSON.stringify(change(readCommentDraft(readStored(key)))))
  const clear = () => writeStored(key, "")
  return { draft, update, clear }
}
