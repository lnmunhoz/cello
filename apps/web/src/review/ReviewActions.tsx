import type { Task } from "@cello/contract/entities"
import { useAtomSet } from "@effect/atom-react"
import { CheckIcon, CornerUpLeftIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../components/ui/Dialog.tsx"
import { Textarea } from "../components/ui/Input.tsx"
import { commands } from "../lib/cello.ts"

/** Approve (to Done) or send back with a note (to In Progress). The page updates when the events arrive. */
export function ReviewActions({ task }: { task: Task }) {
  const approve = useAtomSet(commands.approveReview, { mode: "promiseExit" })
  const sendBack = useAtomSet(commands.sendBackReview, { mode: "promiseExit" })
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState("")

  const run = async (action: () => Promise<{ _tag: string }>) => {
    setBusy(true)
    const exit = await action()
    setBusy(false)
    return exit._tag === "Success"
  }

  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="md" disabled={busy} onClick={() => setAsking(true)}>
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
