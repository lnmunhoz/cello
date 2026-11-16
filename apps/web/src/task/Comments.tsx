import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Comment, Task } from "@cello/contract/entities"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import { useSearch } from "@tanstack/react-router"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { MoreHorizontalIcon, RotateCcwIcon } from "lucide-react"
import { Fragment, type ReactNode, useId, useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Textarea } from "../components/ui/Input.tsx"
import { Markdown } from "../components/ui/Markdown.tsx"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../components/ui/Menu.tsx"
import { commands, commentsFamily } from "../lib/cello.ts"
import { relativeTime } from "../lib/format.ts"
import { Author } from "../presence/Author.tsx"
import { type Who, whoOf } from "../presence/model.ts"
import { ScreenshotBox, ScreenshotThumbs } from "../screenshots/Screenshots.tsx"
import { uploadUrl } from "../screenshots/screenshots.ts"
import { useScreenshotUpload } from "../screenshots/useScreenshotUpload.ts"
import { addScreenshot, removeScreenshot, toComment, useCommentDraft } from "./commentDraft.ts"
import { Reactions } from "./Reactions.tsx"
import { CommentStatusRow, ReceiptTicks } from "./Receipt.tsx"
import { reopenOf, reopenWords, statusCommentId } from "./receipts.ts"
import type { TaskSearch } from "./view.ts"

interface CommentsProps {
  readonly board: BoardState
  readonly task: Task
  readonly placeholder?: string | undefined
  /** More buttons after Comment, in its row (the Review page's Send back and Approve); the row's buttons are then full size. */
  readonly actions?: ((state: { readonly uploading: boolean }) => ReactNode) | undefined
}

/**
 * A task's comments, oldest first, and a box to add one (⌘Enter or Comment): in the task panel, and under
 * an open packet on the Review page. The box takes pasted and dropped screenshots (CEL-73); its words and
 * screenshots are the task's comment draft, kept on this device until sent (the Review page's Send back
 * and Approve read it too). Lucas's comments carry their receipts, and his latest, until it's answered,
 * a status row in the thread saying where it stands (CEL-76). On a task nobody holds that an agent worked
 * on, a line by the Comment button says the comment reopens it and goes to that agent (CEL-110).
 */
export function Comments({ board, task, placeholder = "Leave a comment…", actions }: CommentsProps) {
  const result = useAtomValue(commentsFamily(task.id))
  const add = useAtomSet(commands.addComment, { mode: "promiseExit" })
  const { draft, update, clear } = useCommentDraft(task.id)
  const { uploading, attach } = useScreenshotUpload(uploadUrl({ taskId: task.id }))
  const toSend = uploading > 0 ? null : toComment(draft)
  const headingId = useId()
  const comments = AsyncResult.isSuccess(result) ? result.value.filter((c) => c.deletedAt === null) : []
  // Opened at a comment from ⌘K (`?comment=<id>`, CEL-43): it scrolls into view and flashes once.
  const target = (useSearch({ strict: false }) as TaskSearch).comment
  const statusAfter = statusCommentId(comments)
  // On a task nobody holds, a comment goes to the agent that last worked on it and reopens it (CEL-110).
  const reopen = reopenOf(board, task)

  const submit = async () => {
    if (toSend === null) return
    const exit = await add({ taskId: task.id, ...toSend })
    if (exit._tag === "Success") clear()
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h3 id={headingId} className="text-[13px] font-semibold">
        Comments
      </h3>
      {AsyncResult.isInitial(result) ? <p className="text-xs text-faint">Loading comments…</p> : null}
      <ul className="flex flex-col gap-2">
        {comments.map((c) => (
          <Fragment key={c.id}>
            <CommentItem
              board={board}
              task={task}
              comment={c}
              comments={comments}
              author={whoOf(board, c.actorId, c.sessionId, c.agentId, c)}
              target={c.id === target}
            />
            {c.id === statusAfter ? <CommentStatusRow board={board} task={task} comment={c} comments={comments} /> : null}
          </Fragment>
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        <ScreenshotBox
          label="New comment"
          placeholder={placeholder}
          value={draft.body}
          screenshots={draft.attachments}
          onChange={(body) => update((d) => ({ ...d, body }))}
          onAttach={(files) => void attach(files, (attachment) => update((d) => addScreenshot(d, attachment)))}
          onRemove={(id) => update((d) => removeScreenshot(d, id))}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {reopen ? (
            <p className="mr-auto flex min-w-0 items-center gap-1.5 text-xs leading-4 text-muted" data-reopen-hint={reopen.reopens ? "reopens" : "gives-back"}>
              <RotateCcwIcon aria-hidden className="size-3 shrink-0" />
              <span className="min-w-0">{reopenWords(task, reopen)}</span>
            </p>
          ) : null}
          {uploading > 0 ? <span className="text-xs text-muted">Uploading…</span> : null}
          <Button variant="secondary" size={actions ? "md" : "sm"} onClick={submit} disabled={toSend === null}>
            Comment
          </Button>
          {actions?.({ uploading: uploading > 0 })}
        </div>
      </div>
    </section>
  )
}

/** `target`: the comment the task was opened at; it's scrolled to on arrival and flashes once. `comments`: the thread, for its receipt. */
function CommentItem({ board, task, comment, comments, author, target }: {
  board: BoardState
  task: Task
  comment: Comment
  comments: ReadonlyArray<Comment>
  author: Who
  target: boolean
}) {
  const edit = useAtomSet(commands.editComment, { mode: "promiseExit" })
  const remove = useAtomSet(commands.deleteComment)
  const [draft, setDraft] = useState<string | null>(null)

  const save = async () => {
    if (draft === null || draft.trim() === "" || draft.trim() === comment.body) return setDraft(null)
    const exit = await edit({ id: comment.id, body: draft.trim() })
    if (exit._tag === "Success") setDraft(null)
  }

  return (
    <li
      data-comment-id={comment.id}
      data-target={target ? "" : undefined}
      ref={target ? (el) => el?.scrollIntoView({ block: "center" }) : undefined}
      className={`flex flex-col gap-1.5 rounded-lg border border-line bg-raised px-3 py-2.5 shadow-card ${target ? "comment-flash" : ""}`}
    >
      <div className="flex items-center gap-2 text-xs">
        {/* The main session or a subagent of it (CEL-55), and the model and effort that wrote it (CEL-119). */}
        <span className="flex min-w-0" data-comment-author title={author.parent ? `${author.name}, under ${author.parent}` : author.name}>
          <Author who={author} />
        </span>
        <span className="text-faint">
          {relativeTime(comment.createdAt)}
          {comment.updatedAt > comment.createdAt ? " · edited" : ""}
        </span>
        <span className="ml-auto">
          <Menu
            onAction={(value) => {
              if (value === "edit") setDraft(comment.body)
              if (value === "delete") remove({ id: comment.id })
            }}
          >
            <MenuTrigger aria-label="Comment actions">
              <MoreHorizontalIcon className="size-3.5" />
            </MenuTrigger>
            <MenuContent>
              <MenuItem value="edit">Edit</MenuItem>
              <MenuItem value="delete" variant="danger">
                Delete
              </MenuItem>
            </MenuContent>
          </Menu>
        </span>
      </div>
      {draft === null ? (
        comment.body === "" ? null : <Markdown source={comment.body} />
      ) : (
        <div className="flex flex-col gap-2">
          <Textarea
            variant="comment"
            aria-label="Edit comment"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save()
              if (e.key === "Escape") setDraft(null)
            }}
          />
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button variant="secondary" size="sm" onClick={save}>
              Save
            </Button>
          </div>
        </div>
      )}
      <ScreenshotThumbs shots={comment.attachments ?? []} size="sm" label="Screenshots" />
      {/* The footer: emoji reactions (CEL-77), and Lucas's receipt at the right (CEL-76). */}
      {draft === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <Reactions board={board} comment={comment} />
          <ReceiptTicks board={board} task={task} comment={comment} comments={comments} />
        </div>
      ) : null}
    </li>
  )
}
