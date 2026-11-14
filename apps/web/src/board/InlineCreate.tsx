import { placementAtEnd } from "@cello/client/sync/selectors"
import type { Project, Status, Task } from "@cello/contract/entities"
import { useAtomSet } from "@effect/atom-react"
import { useState } from "react"
import { Input } from "../components/ui/Input.tsx"
import { commands } from "../lib/cello.ts"

/**
 * The column `+`: type a title, Enter creates the task at the bottom of the column, so tasks keep
 * the order you typed them in. Stays open for the next one; Escape closes.
 */
export function InlineCreate({ project, status, tasks, onDone }: { project: Project; status: Status; tasks: ReadonlyArray<Task>; onDone: () => void }) {
  const [title, setTitle] = useState("")
  const create = useAtomSet(commands.createTask)
  return (
    <Input
      variant="card"
      autoFocus
      aria-label={`New task title in ${status.name}`}
      placeholder="Task title, then Enter"
      value={title}
      onChange={(e) => setTitle(e.currentTarget.value)}
      onBlur={() => {
        if (title.trim() === "") onDone()
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault()
          onDone()
        } else if (e.key === "Enter" && title.trim() !== "") {
          e.preventDefault()
          create({ projectId: project.id, title: title.trim(), statusId: status.id, ...placementAtEnd(tasks) })
          setTitle("")
        }
      }}
    />
  )
}
