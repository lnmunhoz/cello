import type { BoardState } from "@cello/client/sync/applyEvents"
import { describeError } from "@cello/client/commands/describeError"
import type { Task } from "@cello/contract/entities"
import { byPosition } from "@cello/shared/milestone"
import { useAtomSet } from "@effect/atom-react"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import { MilestoneIcon, PlusIcon } from "lucide-react"
import { useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../components/ui/Dialog.tsx"
import { Field } from "../components/ui/Field.tsx"
import { Input } from "../components/ui/Input.tsx"
import { Select } from "../components/ui/Select.tsx"
import { commands } from "../lib/cello.ts"
import { newMilestoneStep } from "./newMilestone.ts"

const NONE = "none"
const NEW = "new"

/**
 * The task panel's Milestone property (CEL-113): the project's open milestones in their order, None, and
 * New milestone…, which names one and puts the task in it. A closed milestone the task is still in shows
 * as chosen, marked closed, but no other task can pick it.
 */
export function MilestonePicker({ board, task }: { board: BoardState; task: Task }) {
  const setMilestone = useAtomSet(commands.setTaskMilestone)
  const [creating, setCreating] = useState(false)
  const current = task.milestoneId ?? null
  const milestones = Object.values(board.milestones)
    .filter((m) => m.projectId === task.projectId && (m.state === "open" || m.id === current))
    .sort(byPosition)
  const icon = <MilestoneIcon aria-hidden className="size-3.5 text-muted" />
  return (
    <>
      <Select
        label="Milestone"
        searchable
        placeholder="No milestone"
        value={current ?? NONE}
        options={[
          { value: NONE, label: "No milestone" },
          ...milestones.map((m) => ({ value: m.id, label: m.state === "closed" ? `${m.name} (closed)` : m.name, icon })),
          { value: NEW, label: "New milestone…", icon: <PlusIcon aria-hidden className="size-3.5 text-muted" /> },
        ]}
        onValueChange={(value) => {
          if (value === NEW) return setCreating(true)
          const milestoneId = value === null || value === NONE ? null : value
          if (milestoneId !== current) setMilestone({ id: task.id, milestoneId })
        }}
      />
      <NewMilestoneDialog open={creating} onOpenChange={setCreating} board={board} task={task} />
    </>
  )
}

/**
 * Names a new milestone (last in the project's order) and puts the task in it; a name an open milestone
 * already has puts the task in that one (newMilestone.ts).
 */
function NewMilestoneDialog({ open, onOpenChange, board, task }: { open: boolean; onOpenChange: (open: boolean) => void; board: BoardState; task: Task }) {
  const create = useAtomSet(commands.createMilestone, { mode: "promiseExit" })
  const assign = useAtomSet(commands.setTaskMilestone, { mode: "promiseExit" })
  const [name, setName] = useState("")
  const [goal, setGoal] = useState("")
  const [error, setError] = useState<string | null>(null)
  const project = board.projects[task.projectId]

  const close = () => {
    onOpenChange(false)
    setName("")
    setGoal("")
    setError(null)
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    const step = newMilestoneStep(Object.values(board.milestones), task.projectId, project?.key ?? "This project", name)
    if (step.kind === "problem") return setError(step.message)
    const exit: Exit.Exit<unknown, unknown> = step.kind === "assign"
      ? await assign({ id: task.id, milestoneId: step.milestoneId })
      : await create({ projectId: task.projectId, name: step.name, ...(goal.trim() ? { goal: goal.trim() } : {}), taskId: task.id })
    if (Exit.isSuccess(exit)) close()
    else setError(describeError(Cause.squash(exit.cause)))
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent size="sm">
        <div className="flex flex-col gap-1">
          <DialogTitle>New milestone</DialogTitle>
          <DialogDescription>
            A goal for {project?.name ?? "the project"}, last in its order. {task.key} goes in it.
          </DialogDescription>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label="Name" htmlFor="milestone-name" error={error}>
            <Input
              id="milestone-name"
              autoFocus
              value={name}
              placeholder="M4"
              aria-invalid={error ? true : undefined}
              onChange={(e) => {
                setName(e.currentTarget.value)
                setError(null)
              }}
            />
          </Field>
          <Field label="Goal (optional)" htmlFor="milestone-goal">
            <Input id="milestone-goal" value={goal} placeholder="What it's for, in one line" onChange={(e) => setGoal(e.currentTarget.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose>Cancel</DialogClose>
            <Button type="submit" variant="primary">
              Create milestone
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
