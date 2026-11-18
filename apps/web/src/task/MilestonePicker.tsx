import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Task } from "@cello/contract/entities"
import { byPosition } from "@cello/domain/milestone"
import { useAtomSet } from "@effect/atom-react"
import { MilestoneIcon, PlusIcon } from "lucide-react"
import { useState } from "react"
import { Select } from "../components/ui/Select.tsx"
import { commands } from "../lib/cello.ts"
import { MilestoneDialog } from "../milestones/MilestoneDialog.tsx"

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
      <MilestoneDialog open={creating} onOpenChange={setCreating} board={board} mode={{ kind: "create", projectId: task.projectId, task }} />
    </>
  )
}
