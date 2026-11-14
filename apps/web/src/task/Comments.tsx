import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Comment, Task } from "@cello/contract/entities"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { MoreHorizontalIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Textarea } from "../components/ui/Input.tsx"
import { Markdown } from "../components/ui/Markdown.tsx"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../components/ui/Menu.tsx"
import { commands, commentsFamily } from "../lib/cello.ts"
import { relativeTime } from "../lib/format.ts"

export function Comments({ board, task }: { board: BoardState; task: Task }) {
  const result = useAtomValue(commentsFamily(task.id))
  const add = useAtomSet(commands.addComment, { mode: "promiseExit" })
  const [body, setBody] = useState("")
  const comments = AsyncResult.isSuccess(result) ? result.value.filter((c) => c.deletedAt === null) : []

  const submit = async () => {
    if (body.trim() === "") return
    const exit = await add({ taskId: task.id, body: body.trim() })
    if (exit._tag === "Success") setBody("")
  }

  return (
    <section aria-labelledby="comments-heading" className="flex flex-col gap-3">
      <h3 id="comments-heading" className="text-[13px] font-semibold">
        Comments
      </h3>
      {AsyncResult.isInitial(result) ? <p className="text-xs text-faint">Loading comments…</p> : null}
      <ul className="flex flex-col gap-2">
        {comments.map((c) => (
          <CommentItem key={c.id} comment={c} author={board.actors[c.actorId]?.name ?? "Someone"} />
        ))}
      </ul>
      <div className="flex flex-col gap-2">
        <Textarea
          variant="comment"
          aria-label="New comment"
          placeholder="Leave a comment…"
          value={body}
          onChange={(e) => setBody(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={submit} disabled={body.trim() === ""}>
            Comment
          </Button>
        </div>
      </div>
    </section>
  )
}

function CommentItem({ comment, author }: { comment: Comment; author: string }) {
  const edit = useAtomSet(commands.editComment, { mode: "promiseExit" })
  const remove = useAtomSet(commands.deleteComment)
  const [draft, setDraft] = useState<string | null>(null)

  const save = async () => {
    if (draft === null || draft.trim() === "" || draft.trim() === comment.body) return setDraft(null)
    const exit = await edit({ id: comment.id, body: draft.trim() })
    if (exit._tag === "Success") setDraft(null)
  }

  return (
    <li data-comment-id={comment.id} className="flex flex-col gap-1.5 rounded-lg border border-line bg-raised px-3 py-2.5 shadow-card">
      <div className="flex items-center gap-2 text-xs">
        <span className="font-medium text-ink">{author}</span>
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
        <Markdown source={comment.body} />
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
    </li>
  )
}
