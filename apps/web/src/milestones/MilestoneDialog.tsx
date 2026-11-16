import type { BoardState } from "@cello/client/sync/applyEvents"
import { describeError } from "@cello/client/commands/describeError"
import type { Milestone, Task } from "@cello/contract/entities"
import { useAtomSet } from "@effect/atom-react"
import * as Cause from "effect/Cause"
import * as Exit from "effect/Exit"
import { useState, type FormEvent } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "../components/ui/Dialog.tsx"
import { Field } from "../components/ui/Field.tsx"
import { Input } from "../components/ui/Input.tsx"
import { commands } from "../lib/cello.ts"
import { newMilestoneStep } from "../task/newMilestone.ts"

type Mode =
  /** A new milestone, last in the project's order; with `task`, that task goes in it (the task panel's New milestone…). */
  | { readonly kind: "create"; readonly projectId: string; readonly task?: Task }
  /** The milestone's name, goal and date (its page's Edit). */
  | { readonly kind: "edit"; readonly milestone: Milestone }

/**
 * New milestone (CEL-113) and Edit milestone (CEL-132): a name, a one-line goal and a target date. A new
 * name an open milestone already has puts the task in that one, or, with no task, is refused before
 * anything is sent (newMilestone.ts).
 */
export function MilestoneDialog({ open, onOpenChange, board, mode }: { open: boolean; onOpenChange: (open: boolean) => void; board: BoardState; mode: Mode }) {
  const create = useAtomSet(commands.createMilestone, { mode: "promiseExit" })
  const assign = useAtomSet(commands.setTaskMilestone, { mode: "promiseExit" })
  const update = useAtomSet(commands.updateMilestone, { mode: "promiseExit" })
  const editing = mode.kind === "edit" ? mode.milestone : null
  const projectId = mode.kind === "edit" ? mode.milestone.projectId : mode.projectId
  const task = mode.kind === "create" ? mode.task : undefined
  const project = board.projects[projectId]
  const [name, setName] = useState(editing?.name ?? "")
  const [goal, setGoal] = useState(editing?.goal ?? "")
  const [date, setDate] = useState(editing?.targetDate ?? "")
  const [error, setError] = useState<string | null>(null)
  // Each opening starts from the milestone as it is now (it may have changed since), or from blank.
  const [shown, setShown] = useState(open)
  if (open !== shown) {
    setShown(open)
    if (open) {
      setName(editing?.name ?? "")
      setGoal(editing?.goal ?? "")
      setDate(editing?.targetDate ?? "")
      setError(null)
    }
  }
  const close = () => onOpenChange(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const targetDate = date === "" ? null : date
    let exit: Exit.Exit<unknown, unknown>
    if (editing) {
      if (name.trim() === "") return setError("Give it a name")
      exit = await update({
        id: editing.id,
        ...(name.trim() !== editing.name ? { name: name.trim() } : {}),
        ...(goal.trim() !== editing.goal ? { goal: goal.trim() } : {}),
        ...(targetDate !== editing.targetDate ? { targetDate } : {}),
      })
    } else {
      const key = project?.key ?? "This project"
      const step = newMilestoneStep(Object.values(board.milestones), projectId, key, name)
      if (step.kind === "problem") return setError(step.message)
      if (step.kind === "assign" && !task) return setError(`${key} already has a milestone named ${name.trim()}`)
      exit = step.kind === "assign"
        ? await assign({ id: task!.id, milestoneId: step.milestoneId })
        : await create({
          projectId,
          name: step.name,
          ...(goal.trim() ? { goal: goal.trim() } : {}),
          ...(targetDate ? { targetDate } : {}),
          ...(task ? { taskId: task.id } : {}),
        })
    }
    if (Exit.isSuccess(exit)) close()
    else setError(describeError(Cause.squash(exit.cause)))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm">
        <div className="flex flex-col gap-1">
          <DialogTitle>{editing ? "Edit milestone" : "New milestone"}</DialogTitle>
          <DialogDescription>
            {editing
              ? `${editing.name} in ${project?.name ?? "the project"}.`
              : `A goal for ${project?.name ?? "the project"}, last in its order.${task ? ` ${task.key} goes in it.` : ""}`}
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
          <Field label="Target date (optional)" htmlFor="milestone-date">
            <Input id="milestone-date" type="date" value={date} onChange={(e) => setDate(e.currentTarget.value)} />
          </Field>
          <div className="flex justify-end gap-2">
            <DialogClose>Cancel</DialogClose>
            <Button type="submit" variant="primary">
              {editing ? "Save" : "Create milestone"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
