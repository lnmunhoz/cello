import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Task } from "@cello/contract/entities"
import { useAtomSet } from "@effect/atom-react"
import { CheckIcon, CornerUpLeftIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../components/ui/Dialog.tsx"
import { Textarea } from "../components/ui/Input.tsx"
import { commands } from "../lib/cello.ts"
import { Comments } from "../task/Comments.tsx"
import { sendBackNote } from "./queue.ts"

/**
 * The Review page's decision (CEL-70): the task's comments (the task panel's thread) and one box, with
 * Comment, Send back and Approve under it. Comment keeps the task In Review and reaches the agent like
 * any comment; Send back sends the box's text as its note, or asks for one when the box is empty.
 */
export function CommentOrDecide({ board, task, onDecided }: { board: BoardState; task: Task; onDecided?: (() => void) | undefined }) {
  const [typed, setTyped] = useState("")
  return (
    <Comments
      board={board}
      task={task}
      draft={{ value: typed, onChange: setTyped }}
      placeholder="Leave a comment, or write what to change and Send back…"
      actions={<ReviewActions task={task} onDecided={onDecided} typed={typed} onNoteSent={() => setTyped("")} />}
    />
  )
}

interface ReviewActionsProps {
  readonly task: Task
  readonly onDecided?: (() => void) | undefined
  /**
   * What's typed in the comment box beside these buttons (the Review page, CEL-70): Send back sends it
   * as the note, then `onNoteSent` clears the box. Empty or not given, Send back asks for a note.
   */
  readonly typed?: string | undefined
  readonly onNoteSent?: (() => void) | undefined
}

/**
 * Approve (to Done) or send back with a note (to In Progress). The page updates when the events
 * arrive; `onDecided` runs once the server took the decision (the Review page opens the next packet).
 */
export function ReviewActions({ task, onDecided, typed = "", onNoteSent }: ReviewActionsProps) {
  const approve = useAtomSet(commands.approveReview, { mode: "promiseExit" })
  const sendBack = useAtomSet(commands.sendBackReview, { mode: "promiseExit" })
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState("")
  const typedNote = sendBackNote(typed)

  const run = async (action: () => Promise<{ _tag: string }>) => {
    setBusy(true)
    const exit = await action()
    setBusy(false)
    if (exit._tag === "Success") onDecided?.()
    return exit._tag === "Success"
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="md"
        disabled={busy}
        onClick={async () => {
          if (typedNote === null) return setAsking(true)
          if (await run(() => sendBack({ key: task.key, note: typedNote }))) onNoteSent?.()
        }}
      >
        <CornerUpLeftIcon aria-hidden className="size-3.5" />
        Send back
      </Button>
      <Button variant="primary" size="md" disabled={busy} onClick={() => void run(() => approve({ key: task.key }))}>
        <CheckIcon aria-hidden className="size-3.5" />
        Approve
      </Button>
      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent size="md">
          <div className="flex flex-col gap-1">
            <DialogTitle>Send {task.key} back</DialogTitle>
            <DialogDescription>Say what to change. The note reaches the agent as a comment, and the task goes back to In Progress.</DialogDescription>
          </div>
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault()
              if (note.trim() === "") return
              if (await run(() => sendBack({ key: task.key, note: note.trim() }))) {
                setAsking(false)
                setNote("")
              }
            }}
          >
            <Textarea
              aria-label="Note"
              autoFocus
              placeholder="The poster frame is black; grab one later in the video."
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit()
              }}
            />
            <div className="flex justify-end gap-2">
              <DialogClose>Cancel</DialogClose>
              <Button type="submit" variant="primary" disabled={busy || note.trim() === ""}>
                Send back
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
