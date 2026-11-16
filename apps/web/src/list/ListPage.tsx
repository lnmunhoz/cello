import type { BoardState } from "@cello/client/sync/applyEvents"
import { listGroups, type ListGroup } from "@cello/client/sync/list"
import { useNeedsInputColumn } from "../board/needsInputColumn.ts"
import { orderTasks, type Ordering } from "@cello/client/sync/ordering"
import { projectByKey, taskByKey } from "@cello/client/sync/selectors"
import type { Project, Task } from "@cello/contract/entities"
import { stageStatus } from "@cello/shared/review"
import { useNavigate, useParams } from "@tanstack/react-router"
import { ChevronRightIcon, EyeOffIcon, PlusIcon } from "lucide-react"
import { useRef, useState, type KeyboardEvent } from "react"
import { Centered } from "../app/Home.tsx"
import { InlineCreate } from "../board/InlineCreate.tsx"
import { inLaneOrder, taskLane } from "../board/lanes.ts"
import { useStageLanes } from "../board/useStageLanes.ts"
import { Button } from "../components/ui/Button.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { useOrdering } from "../issues/useOrdering.ts"
import { type Filtered, useFiltered } from "../issues/useFilter.ts"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { useNow } from "../presence/useNow.ts"
import { useTaskView } from "../task/TaskPanel.tsx"
import { behindTask } from "../task/view.ts"
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
  const view = useTaskView()

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
    <div ref={listRef} data-layout="list" aria-label={`${project.name} list`} role="region" className={`min-w-0 flex-1 overflow-y-auto px-3 pb-3 ${behindTask(openNumber !== undefined, view)}`}>
      {groups.map((group) => {
        const { status, tasks } = group
        const folded = collapsed(group)
        return (
          <section key={status.id} data-group={status.name} data-ordering={ordering} aria-labelledby={`group-${status.id}`} className="pb-1">
            <header className="sticky top-0 z-10 bg-surface">
              {/* A band a step off the page: recessed in light, raised in dark (as in Linear's list). */}
              <div className="flex h-9 items-center gap-2 rounded-md bg-sunken pr-1 pl-1 dark:bg-raised">
                <h2 id={`group-${status.id}`} className="flex min-w-0">
                  <button
                    type="button"
                    aria-expanded={!folded}
                    onClick={() => setChosen({ ...chosen, [status.id]: !folded })}
                    className="flex h-7 min-w-0 items-center gap-2 rounded-md px-1.5 text-[13px] font-medium text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <ChevronRightIcon
                      aria-hidden
                      className={`size-3 shrink-0 text-faint transition-transform duration-150 motion-reduce:transition-none ${folded ? "" : "rotate-90"}`}
                    />
                    <StatusIcon category={status.category} color={status.color} />
                    <span className="truncate">{status.name}</span>
                  </button>
                </h2>
                <span
                  className="text-[13px] tabular-nums text-muted"
                  aria-label={filtered.active ? `${tasks.length} of ${totals[status.id]?.length ?? 0} tasks` : `${tasks.length} tasks`}
                  data-group-count
                >
                  {tasks.length}
                  {filtered.active ? <span className="text-faint"> / {totals[status.id]?.length ?? 0}</span> : null}
                </span>
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
              </div>
            </header>
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
