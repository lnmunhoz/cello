import type { BoardState } from "@cello/client/sync/applyEvents"
import type { ListGroup } from "@cello/client/sync/list"
import { milestoneGroups, milestoneTasks, progressOf } from "@cello/client/sync/milestones"
import { boardColumns, placementAtEnd, projectByKey, statusesOf, taskByKey } from "@cello/client/sync/selectors"
import type { Milestone, Project, Task } from "@cello/contract/entities"
import { closeSuggested, mightHaveReopened, progressParts, reopenedAfterClose } from "@cello/shared/milestone"
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { useNavigate, useParams } from "@tanstack/react-router"
import * as Exit from "effect/Exit"
import { CalendarIcon, PencilIcon, TriangleAlertIcon } from "lucide-react"
import { useRef, useState, type KeyboardEvent } from "react"
import { Centered } from "../app/Home.tsx"
import { NotFound } from "../app/NotFound.tsx"
import { useNeedsInputColumn } from "../board/needsInputColumn.ts"
import { Button } from "../components/ui/Button.tsx"
import { Chip } from "../components/ui/Chip.tsx"
import { Input } from "../components/ui/Input.tsx"
import { Markdown } from "../components/ui/Markdown.tsx"
import { commands, historyFamily } from "../lib/cello.ts"
import { formatDue } from "../lib/format.ts"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { GroupHeading } from "../list/GroupHeading.tsx"
import { ListRow } from "../list/ListRow.tsx"
import { keyChars, nextRow, rowOrder } from "../list/rows.ts"
import { useNow } from "../presence/useNow.ts"
import { useTaskPlacement } from "../task/TaskPanel.tsx"
import { behindTask } from "../task/view.ts"
import { CloseSuggestion } from "./CloseSuggestion.tsx"
import { MilestoneDialog } from "./MilestoneDialog.tsx"
import { closedWords, DueWords, MilestoneAgents, ProgressBar, ProgressNumbers } from "./parts.tsx"

/** The No milestone page's id in the address (`/CEL/milestones/none`). */
const NONE = "none"

/**
 * One milestone's page (CEL-132): its name, goal, date, open or closed, and its bar; its tasks grouped
 * by status as the list layout's rows, opening beside the page; Add a task, made already in it; Edit,
 * Close and Reopen. `/milestones/none` is the same page for the open tasks without a milestone.
 * Everything comes from the board's own tasks, so it follows cards as they move.
 */
export function MilestonePage() {
  const { projectKey, milestoneId, number } = useParams({ strict: false }) as { projectKey: string; milestoneId: string; number?: string }
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  const project = board ? projectByKey(board, projectKey) : undefined
  if (!board || !workspaceId || !project) return <Centered>Loading…</Centered>
  const milestone = milestoneId === NONE ? null : board.milestones[milestoneId]
  if (milestone === undefined || (milestone !== null && milestone.projectId !== project.id)) {
    return <NotFound title={`No milestone here in ${project.key}`} projectKey={project.key} />
  }
  const openNumber = number !== undefined && /^\d+$/.test(number) ? Number(number) : undefined
  return <MilestoneView key={milestoneId} board={board} workspaceId={workspaceId} project={project} milestone={milestone} openNumber={openNumber} />
}

function MilestoneView({ board, workspaceId, project, milestone, openNumber }: {
  board: BoardState
  workspaceId: string
  project: Project
  milestone: Milestone | null
  openNumber: number | undefined
}) {
  const id = milestone?.id ?? NONE
  const groups = milestoneGroups(board, workspaceId, project.id, milestone?.id ?? null, { needsInputColumn: useNeedsInputColumn() })
  const open = openNumber === undefined ? undefined : taskByKey(board, project.key, openNumber)
  const placement = useTaskPlacement(openNumber !== undefined)
  const navigate = useNavigate()
  const [folded, setFolded] = useState<Readonly<Record<string, boolean>>>({})
  const [focused, setFocused] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const collapsed = (group: ListGroup) => folded[group.status.id] ?? false
  const rows = rowOrder(groups, collapsed)
  const tabbable = focused !== null && rows.includes(focused) ? focused : open && rows.includes(open.id) ? open.id : (rows[0] ?? null)
  const width = keyChars(groups)
  const onRowKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && openNumber !== undefined) {
      event.preventDefault()
      void navigate({ to: "/$projectKey/milestones/$milestoneId", params: { projectKey: project.key, milestoneId: id } })
      return
    }
    const current = (event.currentTarget as HTMLElement).dataset["rowId"] ?? null
    const next = nextRow(rows, current, event.key)
    if (next === null) return
    event.preventDefault()
    setFocused(next)
    listRef.current?.querySelector<HTMLElement>(`[data-row-id="${next}"]`)?.focus()
  }

  return (
    <div ref={listRef} role="region" aria-label={milestone ? `Milestone ${milestone.name}` : "No milestone"} className={`min-h-0 flex-1 overflow-y-auto px-6 py-6 ${behindTask(placement)}`}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        {milestone ? <Header board={board} workspaceId={workspaceId} project={project} milestone={milestone} /> : <NoneHeader count={milestoneTasks(board, workspaceId, project.id, null).length} />}
        {milestone === null || milestone.state === "open" ? <AddTask board={board} workspaceId={workspaceId} project={project} milestone={milestone} /> : null}
        <div className="flex flex-col">
          {groups.length === 0 ? (
            <p className="px-2 py-4 text-[13px] text-muted">{milestone ? `No tasks in ${milestone.name} yet.` : "Every open task is in a milestone."}</p>
          ) : null}
          {groups.map((group) => {
            const { status, tasks } = group
            const isFolded = collapsed(group)
            return (
              <section key={status.id} data-group={status.name} aria-labelledby={`group-${status.id}`} className="pb-1">
                <GroupHeading status={status} folded={isFolded} onToggle={() => setFolded({ ...folded, [status.id]: !isFolded })} count={tasks.length} />
                {isFolded ? null : (
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
                          milestoneId={id}
                          note={milestone ? <ReopenedNote task={task} board={board} milestone={milestone} /> : null}
                          onFocus={() => setFocused(task.id)}
                          onKeyDown={onRowKeyDown}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function Header({ board, workspaceId, project, milestone: m }: { board: BoardState; workspaceId: string; project: Project; milestone: Milestone }) {
  const progress = progressOf(board, workspaceId, project.id, m.id)
  const close = useAtomSet(commands.closeMilestone)
  const reopen = useAtomSet(commands.reopenMilestone)
  const [editing, setEditing] = useState(false)
  const now = useNow()
  const parts = progressParts(progress)
  return (
    <header className="flex flex-col gap-3" data-milestone-header={m.name}>
      <div className="flex items-start gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-[22px] font-semibold tracking-tight">{m.name}</h1>
            <span data-milestone-state={m.state}>
              <Chip>{m.state === "open" ? "Open" : closedWords(m, now)}</Chip>
            </span>
            <MilestoneAgents board={board} workspaceId={workspaceId} milestoneId={m.id} />
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <CalendarIcon aria-hidden className="size-3" />
            {m.targetDate ? (
              <>
                <span>Target {formatDue(m.targetDate, now)}</span>
                {m.state === "open" ? (
                  <>
                    <span aria-hidden className="text-faint">·</span>
                    <DueWords milestone={m} />
                  </>
                ) : null}
              </>
            ) : (
              <span>No target date</span>
            )}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <PencilIcon aria-hidden className="size-3" />
          Edit
        </Button>
        {m.state === "open" ? (
          <Button variant="secondary" size="sm" onClick={() => close({ id: m.id })}>
            Close milestone
          </Button>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => reopen({ id: m.id })}>
            Reopen
          </Button>
        )}
      </div>
      <Markdown source={m.goal} empty="No goal yet." />
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <ProgressBar progress={progress} board={board} workspaceId={workspaceId} />
          <ProgressNumbers progress={progress} />
        </div>
        {parts.length ? <p className="text-xs text-muted">{parts.join(" · ")}</p> : null}
      </div>
      {closeSuggested(m, progress) ? <CloseSuggestion milestone={m} /> : null}
      <MilestoneDialog open={editing} onOpenChange={setEditing} board={board} mode={{ kind: "edit", milestone: m }} />
    </header>
  )
}

function NoneHeader({ count }: { count: number }) {
  return (
    <header className="flex flex-col gap-1">
      <h1 className="text-[22px] font-semibold tracking-tight">No milestone</h1>
      <p className="text-[13px] text-muted">
        {count} open {count === 1 ? "task" : "tasks"} without a milestone. Put one in a milestone from its Milestone property.
      </p>
    </header>
  )
}

/**
 * "reopened after M3 closed": a task of a closed milestone that moved out of Done after the close. Only a
 * task that could have (mightHaveReopened) has its history read, to see that move.
 */
function ReopenedNote({ task, board, milestone }: { task: Task; board: BoardState; milestone: Milestone }) {
  const category = board.statuses[task.statusId]?.category ?? ""
  if (!mightHaveReopened(task, milestone, category)) return null
  return <ReopenedFromHistory task={task} board={board} milestone={milestone} category={category} />
}

function ReopenedFromHistory({ task, board, milestone, category }: { task: Task; board: BoardState; milestone: Milestone; category: string }) {
  const result = useAtomValue(historyFamily(task.id))
  const history = AsyncResult.isSuccess(result) ? result.value.flatMap((e) => (e.type === "task.moved" ? [{ type: e.type, ts: e.ts, from: e.from, to: e.to }] : [])) : []
  if (!reopenedAfterClose(milestone, category, history, (id) => board.statuses[id]?.category)) return null
  return (
    <span data-reopened className="flex shrink-0 items-center gap-1 text-xs text-idle">
      <TriangleAlertIcon aria-hidden className="size-3" />
      reopened after {milestone.name} closed
    </span>
  )
}

/**
 * Add a task: its title, then Enter makes it in the first not-started status (Todo), at the bottom,
 * already in this milestone, and opens it beside the page.
 */
function AddTask({ board, workspaceId, project, milestone }: { board: BoardState; workspaceId: string; project: Project; milestone: Milestone | null }) {
  const [title, setTitle] = useState("")
  const create = useAtomSet(commands.createTask, { mode: "promiseExit" })
  const navigate = useNavigate()
  const statuses = statusesOf(board, workspaceId)
  const status = statuses.find((s) => s.category === "unstarted" && !s.hidden) ?? statuses.find((s) => !s.hidden)
  if (!status) return null
  const submit = async () => {
    const text = title.trim()
    if (text === "") return
    setTitle("")
    const tasks = boardColumns(board, workspaceId, project.id).tasks[status.id] ?? []
    const exit = await create({ projectId: project.id, title: text, statusId: status.id, ...placementAtEnd(tasks), milestoneId: milestone?.id ?? null })
    if (Exit.isSuccess(exit)) {
      const number = exit.value.number
      void navigate({ to: "/$projectKey/milestones/$milestoneId/$number", params: { projectKey: project.key, milestoneId: milestone?.id ?? NONE, number: String(number) } })
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Input
        aria-label="Add a task"
        placeholder={milestone ? `Add a task to ${milestone.name}: its title, then Enter` : "Add a task: its title, then Enter"}
        value={title}
        onChange={(e) => setTitle(e.currentTarget.value)}
      />
    </form>
  )
}
