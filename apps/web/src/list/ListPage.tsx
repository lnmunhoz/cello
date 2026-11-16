import type { BoardState } from "@cello/client/sync/applyEvents"
import { listGroups, type ListGroup } from "@cello/client/sync/list"
import { useNeedsInputColumn } from "../board/needsInputColumn.ts"
import { orderTasks, type Ordering } from "@cello/client/sync/ordering"
import { projectByKey, taskByKey } from "@cello/client/sync/selectors"
import type { Project, Task } from "@cello/contract/entities"
import { stageStatus } from "@cello/shared/review"
import { useNavigate, useParams } from "@tanstack/react-router"
import { EyeOffIcon, PlusIcon } from "lucide-react"
import { useRef, useState, type KeyboardEvent } from "react"
import { Centered } from "../app/Home.tsx"
import { InlineCreate } from "../board/InlineCreate.tsx"
import { inLaneOrder, taskLane } from "../board/lanes.ts"
import { useStageLanes } from "../board/useStageLanes.ts"
import { Button } from "../components/ui/Button.tsx"
import { useOrdering } from "../issues/useOrdering.ts"
import { type Filtered, useFiltered } from "../issues/useFilter.ts"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { useNow } from "../presence/useNow.ts"
import { useTaskPlacement } from "../task/TaskPanel.tsx"
import { behindTask } from "../task/view.ts"
import { GroupHeading } from "./GroupHeading.tsx"
import { ListRow } from "./ListRow.tsx"
import { isCollapsed, keyChars, nextRow, rowOrder } from "./rows.ts"

export function ListPage({ openNumber }: { openNumber?: number }) {
  const { projectKey } = useParams({ from: "/$projectKey" })
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  const project = board ? projectByKey(board, projectKey) : undefined
  const { ordering } = useOrdering()
  const filtered = useFiltered()
  if (!board || !workspaceId || !project) return <Centered>Loading…</Centered>
  return (
    <div className="flex min-h-0 flex-1">
      <TaskList board={board} workspaceId={workspaceId} project={project} ordering={ordering} openNumber={openNumber} filtered={filtered} />
    </div>
  )
}

/** A project's tasks as rows grouped by status, in status order, with the hidden statuses folded at the end; rows in the ordering. */
function TaskList({
  board,
  workspaceId,
  project,
  ordering,
  openNumber,
  filtered,
}: {
  board: BoardState
  workspaceId: string
  project: Project
  ordering: Ordering
  openNumber?: number
  /** The filter (CEL-52): only the rows it keeps, and only the groups with one. */
  filtered: Filtered
}) {
  // Display → "Group In Progress by stage" (CEL-35): that group's own rows go lane by lane, as on the
  // board (Working included, CEL-105), with a stage column; folded Needs input rows stay below them.
  const lanesOn = useStageLanes()
  const now = useNow()
  const needsInputColumn = useNeedsInputColumn()
  const all = listGroups(board, workspaceId, project.id, { needsInputColumn })
  const lanedId = lanesOn ? (stageStatus(all.map((g) => g.status))?.id ?? null) : null
  const totals = Object.fromEntries(all.map((g) => [g.status.id, g.tasks]))
  const groups = all.flatMap((g) => {
    const tasks = orderTasks(filtered.keep(g.tasks), ordering)
    // While filtering, a group with no match is left out.
    if (filtered.active && tasks.length === 0) return []
    if (g.status.id !== lanedId) return [{ ...g, tasks }]
    const own = tasks.filter((t) => t.statusId === g.status.id)
    return [{ ...g, tasks: [...inLaneOrder(own, (t) => taskLane(board, t, now)), ...tasks.filter((t) => t.statusId !== g.status.id)] }]
  })
  const open = openNumber === undefined ? undefined : taskByKey(board, project.key, openNumber)
  // Groups you folded or unfolded; the rest follow the default in `isCollapsed`.
  const [chosen, setChosen] = useState<Readonly<Record<string, boolean>>>({})
  const [composing, setComposing] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const placement = useTaskPlacement(openNumber !== undefined)

  const collapsed = (group: ListGroup) => isCollapsed(group, chosen, open?.id ?? null)
  const rows = rowOrder(groups, collapsed)
  const tabbable = focused !== null && rows.includes(focused) ? focused : open && rows.includes(open.id) ? open.id : (rows[0] ?? null)
  const width = keyChars(groups)

  const onRowKeyDown = (event: KeyboardEvent<HTMLElement>, task: Task) => {
    if (event.key === "Escape" && openNumber !== undefined) {
      event.preventDefault()
      void navigate({ to: "/$projectKey/issues", params: { projectKey: project.key } })
      return
    }
    const next = nextRow(rows, task.id, event.key)
    if (next === null) return
    event.preventDefault()
    setFocused(next)
    listRef.current?.querySelector<HTMLElement>(`[data-row-id="${next}"]`)?.focus()
  }

  return (
    <div ref={listRef} data-layout="list" aria-label={`${project.name} list`} role="region" className={`min-w-0 flex-1 overflow-y-auto px-3 pb-3 ${behindTask(placement)}`}>
      {groups.map((group) => {
        const { status, tasks } = group
        const folded = collapsed(group)
        return (
          <section key={status.id} data-group={status.name} data-ordering={ordering} aria-labelledby={`group-${status.id}`} className="pb-1">
            <GroupHeading
              status={status}
              folded={folded}
              onToggle={() => setChosen({ ...chosen, [status.id]: !folded })}
              count={tasks.length}
              {...(filtered.active ? { total: totals[status.id]?.length ?? 0 } : {})}
            >
              {status.hidden ? (
                <span title="Hidden on the board" className="flex text-faint">
                  <EyeOffIcon aria-label="Hidden status" className="size-3.5" />
                </span>
              ) : null}
              <span className="ml-auto flex items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`New task in ${status.name}`}
                  onClick={() => {
                    setChosen({ ...chosen, [status.id]: false })
                    setComposing(status.id)
                  }}
                >
                  <PlusIcon className="size-3.5" />
                </Button>
              </span>
            </GroupHeading>
            {composing === status.id ? (
              <div className="py-1.5 pr-2 pl-8">
                <InlineCreate project={project} status={status} tasks={totals[status.id] ?? tasks} onDone={() => setComposing(null)} />
              </div>
            ) : null}
            {folded || tasks.length === 0 ? null : (
              <ul className="flex flex-col pt-0.5">
                {tasks.map((task) => (
                  <li key={task.id}>
                    <ListRow
                      task={task}
                      board={board}
                      project={project}
                      keyChars={width}
                      current={task.id === open?.id}
                      tabbable={task.id === tabbable}
                      stageColumn={status.id === lanedId}
                      onFocus={() => setFocused(task.id)}
                      onKeyDown={(e) => onRowKeyDown(e, task)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
