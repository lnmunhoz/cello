import type { BoardState } from "@cello/client/sync/applyEvents"
import { milestonesOf, milestoneTasks, progressOf } from "@cello/client/sync/milestones"
import { placement, projectByKey } from "@cello/client/sync/selectors"
import type { Milestone, Project } from "@cello/contract/entities"
import { plainText } from "@cello/shared/document"
import { closeSuggested } from "@cello/shared/milestone"
import { useAtomSet } from "@effect/atom-react"
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { ChevronRightIcon, GripVerticalIcon, MilestoneIcon, PlusIcon } from "lucide-react"
import { useState } from "react"
import { Centered } from "../app/Home.tsx"
import { Kanban, KanbanCard, KanbanColumn } from "../board/kanban.tsx"
import { findMove } from "../board/moves.ts"
import { Button } from "../components/ui/Button.tsx"
import { commands } from "../lib/cello.ts"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { useNow } from "../presence/useNow.ts"
import { CloseSuggestion } from "./CloseSuggestion.tsx"
import { MilestoneDialog } from "./MilestoneDialog.tsx"
import { closedWords, DueWords, MilestoneAgents, ProgressBar, ProgressNumbers } from "./parts.tsx"

/** The one list of open milestones the rows are dragged in. */
const OPEN = "open"

/**
 * A project's Milestones tab (CEL-132): its open milestones in the human's order, each with its bar
 * (from the tasks on the board, so it moves as cards move), its due date and who's on it; dragged (or,
 * focused, picked up with Space and moved with the arrows) to reorder. Then the open tasks without a
 * milestone, and the closed milestones folded at the bottom.
 */
export function MilestonesPage() {
  const { projectKey } = useParams({ from: "/$projectKey" })
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  const project = board ? projectByKey(board, projectKey) : undefined
  if (!board || !workspaceId || !project) return <Centered>Loading…</Centered>
  return <Milestones board={board} workspaceId={workspaceId} project={project} />
}

function Milestones({ board, workspaceId, project }: { board: BoardState; workspaceId: string; project: Project }) {
  const { open, closed } = milestonesOf(board, project.id)
  const loose = milestoneTasks(board, workspaceId, project.id, null)
  const [creating, setCreating] = useState(false)
  const update = useAtomSet(commands.updateMilestone)
  const navigate = useNavigate()
  const lists = { [OPEN]: open.map((m) => m.id) }
  const openPage = (m: Milestone) => void navigate({ to: "/$projectKey/milestones/$milestoneId", params: { projectKey: project.key, milestoneId: m.id } })

  // A drop names the row and where it landed; the server places it between its new neighbors, and the
  // row shows there at once.
  const onListsChange = (next: Record<string, string[]>, details: unknown) => {
    const found = findMove(lists, next, (details as { key?: string } | null)?.key)
    if (!found) return
    const others = open.filter((m) => m.id !== found.key)
    update({ id: found.key, ...placement(others, found.index) })
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6" data-milestones-page>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <header className="flex items-start gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <h1 className="text-[22px] font-semibold tracking-tight">Milestones</h1>
            <p className="text-[13px] text-muted">Goals for {project.name}, in the order they come. Drag a row to reorder.</p>
          </div>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <PlusIcon aria-hidden className="size-3.5" />
            New milestone
          </Button>
        </header>

        {open.length === 0 && closed.length === 0 ? (
          <EmptyState project={project} onCreate={() => setCreating(true)} />
        ) : (
          <>
            {open.length > 0 ? (
              <Kanban lists={lists} onListsChange={onListsChange} labels={{ [OPEN]: "Open milestones" }} order={[OPEN]} aria-label="Open milestones">
                {() => [
                  <KanbanColumn key={OPEN} value={OPEN} aria-label="Open milestones" className="flex flex-col gap-2">
                    {({ cards }) =>
                      cards.flatMap((id) => {
                        const m = board.milestones[id]
                        if (!m) return []
                        return [
                          <KanbanCard
                            key={id}
                            value={id}
                            data-milestone-row={m.name}
                            onClick={() => openPage(m)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") openPage(m)
                            }}
                            className="group flex cursor-grab flex-col gap-2 rounded-lg border border-line bg-raised py-3 pr-4 pl-2 shadow-card outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring data-dragging:border-dashed data-dragging:bg-transparent data-dragging:shadow-none data-dragging:*:invisible data-moving:not-data-dragging:ring-2 data-moving:not-data-dragging:ring-ring data-moving:not-data-dragging:shadow-pop"
                          >
                            <MilestoneRow board={board} workspaceId={workspaceId} project={project} milestone={m} />
                          </KanbanCard>,
                        ]
                      })}
                  </KanbanColumn>,
                ]}
              </Kanban>
            ) : (
              <p className="rounded-lg border border-dashed border-line px-4 py-3 text-[13px] text-muted">Every milestone is closed. Make a new one for what comes next.</p>
            )}
            <NoMilestoneLine project={project} count={loose.length} />
            {closed.length > 0 ? <ClosedList board={board} workspaceId={workspaceId} project={project} closed={closed} /> : null}
          </>
        )}
      </div>
      <MilestoneDialog open={creating} onOpenChange={setCreating} board={board} mode={{ kind: "create", projectId: project.id }} />
    </div>
  )
}

/** An open milestone's row: name and goal, who's on it, the due date, the bar and its numbers, and "All done: close M3?". */
function MilestoneRow({ board, workspaceId, project, milestone: m }: { board: BoardState; workspaceId: string; project: Project; milestone: Milestone }) {
  const progress = progressOf(board, workspaceId, project.id, m.id)
  return (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <GripVerticalIcon aria-hidden className="size-3.5 shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        <span className="flex min-w-0 flex-1 items-baseline gap-1.5 text-[13px]">
          <span className="shrink-0 font-semibold text-ink" data-milestone-name>
            {m.name}
          </span>
          {m.goal ? <span className="truncate text-muted">· {plainText(m.goal)}</span> : null}
        </span>
        <MilestoneAgents board={board} workspaceId={workspaceId} milestoneId={m.id} />
        <DueWords milestone={m} />
      </div>
      <div className="flex items-center gap-3 pl-5.5">
        <ProgressBar progress={progress} board={board} workspaceId={workspaceId} />
        <ProgressNumbers progress={progress} />
      </div>
      {closeSuggested(m, progress) ? (
        <div className="pl-5.5">
          <CloseSuggestion milestone={m} />
        </div>
      ) : null}
    </>
  )
}

/** "No milestone · 4 open tasks": opens them, grouped by status, on a page like a milestone's. */
function NoMilestoneLine({ project, count }: { project: Project; count: number }) {
  return (
    <Link
      to="/$projectKey/milestones/$milestoneId"
      params={{ projectKey: project.key, milestoneId: "none" }}
      data-no-milestone={count}
      className="flex h-10 items-center gap-2 rounded-lg border border-dashed border-line px-4 text-[13px] text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="font-medium text-ink">No milestone</span>{" "}
      <span className="tabular-nums">
        · {count} open {count === 1 ? "task" : "tasks"}
      </span>
      <ChevronRightIcon aria-hidden className="ml-auto size-3.5 text-faint" />
    </Link>
  )
}

/** The closed milestones, folded at the bottom: each with when it closed and where its bar ended. */
function ClosedList({ board, workspaceId, project, closed }: { board: BoardState; workspaceId: string; project: Project; closed: ReadonlyArray<Milestone> }) {
  const [shown, setShown] = useState(false)
  const now = useNow()
  return (
    <section aria-label="Closed milestones" className="flex flex-col gap-1">
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setShown(!shown)}
        className="flex h-8 w-fit items-center gap-1.5 rounded-md px-2 text-[13px] font-medium text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRightIcon aria-hidden className={`size-3 transition-transform duration-150 motion-reduce:transition-none ${shown ? "rotate-90" : ""}`} />
        Closed
        <span className="tabular-nums text-faint">{closed.length}</span>
      </button>
      {shown ? (
        <ul className="flex flex-col">
          {closed.map((m) => {
            const progress = progressOf(board, workspaceId, project.id, m.id)
            return (
              <li key={m.id}>
                <Link
                  to="/$projectKey/milestones/$milestoneId"
                  params={{ projectKey: project.key, milestoneId: m.id }}
                  data-closed-milestone={m.name}
                  className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-center gap-3 rounded-md px-3 py-2 text-[13px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="shrink-0 font-medium text-ink">{m.name}</span>
                    {m.goal ? <span className="truncate text-muted">· {plainText(m.goal)}</span> : null}
                  </span>
                  <ProgressBar progress={progress} board={board} workspaceId={workspaceId} size="sm" />
                  <span className="text-xs tabular-nums text-muted" data-closed-at>
                    {closedWords(m, now)}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : null}
    </section>
  )
}

function EmptyState({ project, onCreate }: { project: Project; onCreate: () => void }) {
  return (
    <section aria-label="No milestones yet" className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-6 py-12 text-center">
      <MilestoneIcon aria-hidden className="size-6 text-faint" />
      <h2 className="text-[15px] font-semibold">No milestones yet</h2>
      <p className="max-w-sm text-[13px] text-muted">
        A milestone is a goal for {project.name}, with an optional target date. Put tasks in it, and its bar fills as they're done.
      </p>
      <Button variant="secondary" onClick={onCreate}>
        <PlusIcon aria-hidden className="size-3.5" />
        New milestone
      </Button>
    </section>
  )
}
