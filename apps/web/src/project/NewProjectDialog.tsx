import { describeError } from "@cello/client/commands/describeError"
import { suggestProjectKey } from "@cello/shared/taskKey"
import { useAtomSet } from "@effect/atom-react"
import { useNavigate } from "@tanstack/react-router"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import { useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { ColorPicker, PALETTE } from "../components/ui/ColorPicker.tsx"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../components/ui/Dialog.tsx"
import { Field } from "../components/ui/Field.tsx"
import { Input } from "../components/ui/Input.tsx"
import { commands } from "../lib/cello.ts"
import { useBoard } from "../lib/hooks.ts"
import { keyProblem } from "./keyProblem.ts"

export function NewProjectDialog({ open, onOpenChange, workspaceId }: { open: boolean; onOpenChange: (open: boolean) => void; workspaceId: string }) {
  const board = useBoard()
  const create = useAtomSet(commands.createProject, { mode: "promiseExit" })
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [key, setKey] = useState("")
  const [keyEdited, setKeyEdited] = useState(false)
  const [color, setColor] = useState<string>(PALETTE[1])
  const [repoPath, setRepoPath] = useState("")
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  // After creating, focus goes to the new board, not back to the button that opened the dialog.
  const [created, setCreated] = useState(false)

  const taken = new Map(Object.values(board?.projects ?? {}).map((p) => [p.key, p.name]))
  const effectiveKey = keyEdited ? key : suggestProjectKey(name.trim() || "")
  const shownKey = name.trim() === "" && !keyEdited ? "" : effectiveKey
  const problem = shownKey === "" && !submitted ? null : keyProblem(shownKey, taken)

  const reset = () => {
    setName("")
    setKey("")
    setKeyEdited(false)
    setRepoPath("")
    setServerError(null)
    setSubmitted(false)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (name.trim() === "" || keyProblem(shownKey, taken)) return
    const exit = await create({
      workspaceId,
      name: name.trim(),
      key: shownKey,
      color,
      ...(repoPath.trim() ? { repoPath: repoPath.trim() } : {}),
    })
    if (Exit.isSuccess(exit)) {
      setCreated(true)
      onOpenChange(false)
      reset()
      void navigate({ to: "/$projectKey/issues", params: { projectKey: exit.value.key } })
    } else {
      setServerError(describeError(Cause.squash(exit.cause)))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) reset()
        if (next) setCreated(false)
      }}
    >
      <DialogContent size="md" finalFocus={created ? "none" : undefined}>
        <div className="flex flex-col gap-1">
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>A project is one product, usually one repository, with its own task key.</DialogDescription>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Name" htmlFor="project-name" error={submitted && name.trim() === "" ? "Give it a name" : undefined}>
                <Input id="project-name" autoFocus value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="ThaiLookup" />
              </Field>
            </div>
            <div className="pb-1">
              <ColorPicker label="Project color" value={color} onChange={setColor} />
            </div>
          </div>
          <Field
            label="Key"
            htmlFor="project-key"
            hint={shownKey ? `Tasks will be ${shownKey}-1, ${shownKey}-2…` : "Used in task keys, like THAI-12"}
            error={serverError ?? problem}
          >
            <Input
              id="project-key"
              value={shownKey}
              onChange={(e) => {
                setKeyEdited(true)
                setServerError(null)
                setKey(e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10))
              }}
              placeholder="THAI"
              aria-invalid={problem || serverError ? true : undefined}
            />
          </Field>
          <Field label="Repository path (optional)" htmlFor="project-repo">
            <Input id="project-repo" value={repoPath} onChange={(e) => setRepoPath(e.currentTarget.value)} placeholder="~/projects/thailookup" />
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose>Cancel</DialogClose>
            <Button type="submit" variant="primary">
              Create project
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
