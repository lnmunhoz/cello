import { describeError } from "@cello/client/commands/describeError"
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Attachment, Task } from "@cello/contract/entities"
import { awaitsMerge } from "@cello/domain/review"
import { useAtomSet } from "@effect/atom-react"
import * as Cause from "effect/Cause"
import type * as Exit from "effect/Exit"
import { CheckIcon, CornerUpLeftIcon, LoaderCircleIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../components/ui/Dialog.tsx"
import { Textarea } from "../components/ui/Input.tsx"
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/Tooltip.tsx"
import { commands } from "../lib/cello.ts"
import { useBoard } from "../lib/hooks.ts"
import { Comments } from "../task/Comments.tsx"
import { useCommentDraft } from "../task/commentDraft.ts"
import { deferredDecisions, inTurn, useWaitingDecisions } from "./deferred.ts"
import { type Decision, type DecisionEvent, type DecisionState, decisionNote, decisionStep, IDLE } from "./queue.ts"
import { undoWindowMs, useUndoWindow } from "./undoWindow.ts"

/** Hears a decision as it goes: clicked, then taken by the server or refused. */
type OnDecision = ((event: DecisionEvent) => void) | undefined

/**
 * The Review page's decision (CEL-70): the task's comments (the task panel's thread) and one box, with
 * Comment, Send back and Approve under it. Comment keeps the task In Review and reaches the agent like
 * any comment. Send back and Approve send the box's text as their note, so nothing typed is lost;
 * with the box empty, Send back asks for a note and Approve goes without. Screenshots pasted into the
 * box go too (CEL-73): with Send back's note, or with Approve as a comment holding them and the text.
 * Send back and Approve wait while a screenshot is still uploading.
 */
export function CommentOrDecide({ board, task, onDecision }: { board: BoardState; task: Task; onDecision?: OnDecision }) {
  const { draft, update, clear } = useCommentDraft(task.id)
  return (
    <Comments
      board={board}
      task={task}
      placeholder="Leave a comment, or write what to change and Send back…"
      actions={({ uploading }) => (
        <ReviewActions
          task={task}
          onDecision={onDecision}
          typed={draft.body}
          screenshots={draft.attachments}
          uploading={uploading}
          inRow
          onNoteSent={(withScreenshots) => (withScreenshots ? clear() : update((d) => ({ ...d, body: "" })))}
        />
      )}
    />
  )
}

/** What "Approve and merge" does, on hover and for screen readers (CEL-143). */
const MERGE_HINT = "The agent merges it after you approve, then moves it to Done"

interface ReviewActionsProps {
  readonly task: Task
  readonly onDecision?: OnDecision
  /**
   * What's typed in the comment box beside these buttons (the Review page, CEL-70): Send back and
   * Approve send it as their note, then `onNoteSent` clears the box. Empty or not given, Send back asks
   * for a note and Approve goes without one.
   */
  readonly typed?: string | undefined
  /**
   * Screenshots pasted into that box (CEL-73): Send back's note carries them; Approve posts them as a
   * comment with the typed text, in the same command.
   */
  readonly screenshots?: ReadonlyArray<Attachment> | undefined
  /** A screenshot is still uploading into that box: Send back and Approve wait for it. */
  readonly uploading?: boolean | undefined
  /** What went, so the box can let go of it: `withScreenshots` empties it, otherwise only its text. */
  readonly onNoteSent?: ((withScreenshots: boolean) => void) | undefined
  /**
   * These buttons sit in a row that wraps, beside other things on its line (the comment box's Comment
   * button, a packet's "Submitted by"): a failure takes a line of its own in that row, so the line the
   * buttons are on doesn't grow and nothing on it moves. Without it the buttons and the failure under
   * them are one box, which holds in any parent.
   */
  readonly inRow?: boolean | undefined
}

/** The mark a button shows in place of its icon while its command runs (CEL-187). */
const PendingIcon = () => <LoaderCircleIcon aria-hidden className="size-3.5 motion-safe:animate-spin" />

/**
 * Approve (to Done) or send back with a note (to In Progress). The page updates when the events
 * arrive; `onDecision` hears the click and then whether the server took it (the Review page keeps the
 * row, says so on it, then opens the next packet).
 * While the command runs (CEL-187), its button says so (`aria-busy`, "Approving…") and both wait. When it
 * fails, the reason shows beside them and nothing typed is lost: another click tries again.
 * In a project that merges after approval (CEL-143) Approve reads "Approve and merge": the task stays in
 * In Review as Approved · merging until its agent has merged it. While it waits for that, only Send back
 * is left (the merge failed, or Lucas changed his mind).
 */
export function ReviewActions({ task, onDecision, typed = "", screenshots = [], uploading = false, onNoteSent, inRow = false }: ReviewActionsProps) {
  const board = useBoard()
  const mergeAfter = board?.projects[task.projectId]?.mergeAfterApproval === true
  const merging = awaitsMerge(task, board?.statuses[task.statusId])
  const approve = useAtomSet(commands.approveReview, { mode: "promiseExit" })
  const sendBack = useAtomSet(commands.sendBackReview, { mode: "promiseExit" })
  const [state, setState] = useState<DecisionState>(IDLE)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState("")
  const typedNote = decisionNote(typed)
  const attachmentIds = screenshots.map((a) => a.id)
  const withShots = attachmentIds.length > 0 ? { attachmentIds } : {}
  const sendBackWith = (note: string) => sendBack({ key: task.key, note, ...withShots })
  const pending = state.phase === "pending" || state.phase === "sending" ? state.decision : null
  // A decision from this task waiting in its undo window on the Review page holds the panel's buttons too (CEL-191).
  const windowOpen = useWaitingDecisions().includes(task.key)
  const waiting = (state.phase !== "idle" && state.phase !== "failed") || uploading || windowOpen
  const failure = state.phase === "failed" ? state.message : null
  // The undo window (CEL-191) belongs to the Review page, which has a row to say "Approved · Undo" on and
  // hears the events; elsewhere (the task panel) a decision is sent at once, as before.
  const undoMs = undoWindowMs(useUndoWindow())
  const deferMs = onDecision ? undoMs : null

  /**
   * Whether the server took it. Where a page listens (`onDecision`), it shows what was decided and takes
   * the row away, so the buttons stay as they are meanwhile; elsewhere they go back to idle.
   * With the undo window on, nothing is sent at the click: the decision waits (deferredDecisions) and goes
   * when the window ends. The answer is false if Undo took it back, so the box keeps what was typed.
   */
  const run = (decision: Decision, action: () => Promise<Exit.Exit<unknown, unknown>>): Promise<boolean> => {
    const step = (event: DecisionEvent) => {
      setState((s) => (event.type === "taken" && !onDecision ? IDLE : decisionStep(s, event)))
      onDecision?.(event)
    }
    const send = async () => {
      const exit = await action()
      if (exit._tag === "Success") {
        step({ type: "taken" })
        return true
      }
      step({ type: "refused", message: describeError(Cause.squash(exit.cause), { subject: task.key }) })
      return false
    }
    if (deferMs === null) {
      step({ type: "clicked", decision })
      return send()
    }
    if (deferredDecisions.has(task.key)) return Promise.resolve(false)
    step({ type: "clicked", decision, undoable: true })
    return new Promise<boolean>((resolve) => {
      deferredDecisions.start(task.key, deferMs, {
        send: () => {
          step({ type: "sent" })
          void inTurn(send).then(resolve)
        },
        undone: () => {
          step({ type: "undone" })
          resolve(false)
        },
      })
    })
  }

  // On a line of its own under the buttons, so nothing moves under the pointer.
  const alert = failure === null ? null : (
    <p role="alert" data-decision-failed="" className={`min-w-0 text-right text-xs text-danger ${inRow ? "order-last basis-full" : ""}`}>
      {failure}. Try again.
    </p>
  )

  const approveButton = (
    <Button
      variant="primary"
      size="md"
      data-decide="approved"
      disabled={waiting}
      aria-busy={pending === "approved"}
      onClick={async () => {
        const approved = await run("approved", () => approve({ key: task.key, ...(typedNote === null ? {} : { note: typedNote }), ...withShots }))
        if (approved && (typedNote !== null || attachmentIds.length > 0)) onNoteSent?.(attachmentIds.length > 0)
      }}
    >
      {pending === "approved" ? <PendingIcon /> : <CheckIcon aria-hidden className="size-3.5" />}
      {pending === "approved" ? "Approving…" : mergeAfter ? "Approve and merge" : "Approve"}
    </Button>
  )

  return (
    <div data-review-actions="" className={inRow ? "contents" : "flex min-w-0 flex-col items-end gap-1.5"}>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="secondary"
          size="md"
          data-decide="sent_back"
          disabled={waiting}
          aria-busy={pending === "sent_back"}
          onClick={async () => {
            if (typedNote === null) return setAsking(true)
            if (await run("sent_back", () => sendBackWith(typedNote))) onNoteSent?.(true)
          }}
        >
          {pending === "sent_back" ? <PendingIcon /> : <CornerUpLeftIcon aria-hidden className="size-3.5" />}
          {pending === "sent_back" ? "Sending back…" : "Send back"}
        </Button>
        {merging ? null : mergeAfter ? (
          <Tooltip>
            <TooltipTrigger render={approveButton} />
            <TooltipContent side="top">{MERGE_HINT}</TooltipContent>
          </Tooltip>
        ) : approveButton}
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
                if (note.trim() === "" || waiting) return
                const sent = run("sent_back", () => sendBackWith(note.trim()))
                // The window starts with the click: the dialog closes, and Undo reopens it with the note still in it.
                if (deferMs !== null) setAsking(false)
                if (!(await sent)) {
                  // Undone or refused: back in the dialog, the note and the failure line there.
                  if (deferMs !== null) setAsking(true)
                } else {
                  setAsking(false)
                  setNote("")
                  if (attachmentIds.length) onNoteSent?.(true)
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
              {alert}
              <div className="flex justify-end gap-2">
                <DialogClose>Cancel</DialogClose>
                <Button type="submit" variant="primary" disabled={waiting || note.trim() === ""} aria-busy={pending === "sent_back"}>
                  {pending === "sent_back" ? <PendingIcon /> : null}
                  {pending === "sent_back" ? "Sending back…" : "Send back"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {asking ? null : alert}
    </div>
  )
}
