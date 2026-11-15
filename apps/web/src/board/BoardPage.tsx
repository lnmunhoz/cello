import { boardColumns, placement, projectByKey } from "@cello/client/sync/selectors"
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Project, Status, Task } from "@cello/contract/entities"
import { useAtomSet } from "@effect/atom-react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { ChevronRightIcon, EyeOffIcon, PlusIcon } from "lucide-react"
import { LayoutGroup, MotionConfig, motion } from "motion/react"
import { useState } from "react"
import { Centered } from "../app/Home.tsx"
import { Button } from "../components/ui/Button.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { commands } from "../lib/cello.ts"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { TaskPanel } from "../task/TaskPanel.tsx"
import { CardBody } from "./Card.tsx"
import { InlineCreate } from "./InlineCreate.tsx"
import { Kanban, KanbanCard, KanbanColumn } from "./kanban.tsx"
import { findMove } from "./moves.ts"

const layoutTransition = { type: "spring", stiffness: 520, damping: 42, mass: 0.7 } as const

/** New cards land at the bottom of their column, so a card you just made (still optimistic) scrolls into view. */
const reveal = (el: HTMLElement | null) => el?.scrollIntoView({ block: "nearest", inline: "nearest" })

export function BoardPage({ openNumber }: { openNumber?: number }) {
  const { projectKey } = useParams({ from: "/$projectKey" })
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  const project = board ? projectByKey(board, projectKey) : undefined
  if (!board || !workspaceId || !project) return <Centered>Loading…</Centered>
  return (
    <div className="flex min-h-0 flex-1">
      <Board board={board} workspaceId={workspaceId} project={project} openNumber={openNumber} />
      {openNumber !== undefined ? <TaskPanel board={board} project={project} number={openNumber} /> : null}
    </div>
  )
}

function Board({ board, workspaceId, project, openNumber }: { board: BoardState; workspaceId: string; project: Project; openNumber?: number }) {
  const columns = boardColumns(board, workspaceId, project.id)
  const [unfolded, setUnfolded] = useState<ReadonlyArray<string>>([])
  const [composing, setComposing] = useState<string | null>(null)
  const move = useAtomSet(commands.moveTask)
  const navigate = useNavigate()

  const shown: Status[] = [...columns.visible, ...columns.hidden.filter((s) => unfolded.includes(s.id))]
  const folded = columns.hidden.filter((s) => !unfolded.includes(s.id))
  const lists = Object.fromEntries(shown.map((s) => [s.id, (columns.tasks[s.id] ?? []).map((t) => t.id)]))
  const labels = Object.fromEntries(shown.map((s) => [s.id, s.name]))

  const open = (task: Task) => {
    if (task.number > 0) void navigate({ to: "/$projectKey/$number", params: { projectKey: project.key, number: String(task.number) } })
  }

  const onListsChange = (next: Record<string, string[]>, details: unknown) => {
    const found = findMove(lists, next, (details as { key?: string } | null)?.key)
    if (!found) return
    const task = board.tasks[found.key]
    if (!task || task.number === 0) return
    const target = (columns.tasks[found.to] ?? []).filter((t) => t.id !== task.id)
    const place = placement(target, found.index)
    move({ id: task.id, statusId: found.to, ...place })
  }

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        {/* Its sideways scroll stays inside (no back swipe from its edge). In a narrow window an open task takes its place. */}
        <div className={`flex min-w-0 flex-1 gap-3 overflow-x-auto overscroll-x-contain px-3 pb-3 ${openNumber !== undefined ? "max-md:hidden" : ""}`}>
          <Kanban
            lists={lists}
            onListsChange={onListsChange}
            labels={labels}
            order={shown.map((s) => s.id)}
            aria-label={`${project.name} board`}
            className="flex items-start gap-3"
          >
            {() =>
              shown.map((status) => {
                const tasks = columns.tasks[status.id] ?? []
                return (
                  <section
                    key={status.id}
                    data-column={status.name}
                    aria-labelledby={`col-${status.id}`}
                    className="flex max-h-full w-[300px] shrink-0 flex-col rounded-lg bg-sunken"
                  >
                    <header className="flex h-10 shrink-0 items-center gap-2 px-3">
                      <StatusIcon category={status.category} color={status.color} />
                      <h2 id={`col-${status.id}`} className="text-[13px] font-medium">
                        {status.name}
                      </h2>
                      <span className="text-[13px] tabular-nums text-muted" aria-label={`${tasks.length} tasks`}>
                        {tasks.length}
                      </span>
                      <span className="ml-auto flex items-center">
                        {status.hidden ? (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Fold ${status.name}`}
                            onClick={() => setUnfolded(unfolded.filter((id) => id !== status.id))}
                          >
                            <EyeOffIcon className="size-3.5" />
                          </Button>
                        ) : null}
                        <Button variant="ghost" size="icon" aria-label={`New task in ${status.name}`} onClick={() => setComposing(status.id)}>
                          <PlusIcon className="size-3.5" />
                        </Button>
                      </span>
                    </header>
                    {composing === status.id ? (
                      <div className="px-2 pb-1.5">
                        <InlineCreate
                          project={project}
                          status={status}
                          tasks={tasks}
                          onDone={() => setComposing(null)}
                        />
                      </div>
                    ) : null}
                    <KanbanColumn
                      value={status.id}
                      aria-labelledby={`col-${status.id}`}
                      className="flex min-h-16 flex-col gap-1.5 overflow-y-auto px-2 pb-2"
                      // The column scrolls, so its cards' layout animations must account for its scroll offset.
                      render={(props) => <motion.div {...(props as object)} layoutScroll />}
                    >
                      {({ cards }) =>
                        cards.map((id) => {
                          const task = board.tasks[id]
                          if (!task) return null
                          return (
                            <KanbanCard
                              key={id}
                              value={id}
                              data-card-id={id}
                              data-task-key={task.key}
                              ref={task.number === 0 ? reveal : undefined}
                              aria-current={task.number === openNumber ? "true" : undefined}
                              onClick={() => open(task)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") open(task)
                              }}
                              className="group flex cursor-grab flex-col gap-1.5 rounded-lg border border-line bg-raised px-3 py-2.5 shadow-card outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring aria-[current=true]:border-accent data-dragging:border-dashed data-dragging:bg-transparent data-dragging:shadow-none data-dragging:*:invisible data-moving:not-data-dragging:ring-2 data-moving:not-data-dragging:ring-ring data-moving:not-data-dragging:shadow-pop"
                              render={(props) => <motion.div {...(props as object)} layout="position" transition={layoutTransition} />}
                            >
                              <CardBody task={task} board={board} />
                            </KanbanCard>
                          )
                        })
                      }
                    </KanbanColumn>
                  </section>
                )
              })
            }
          </Kanban>
          {folded.length > 0 ? (
            <aside aria-label="Hidden columns" className="flex w-52 shrink-0 flex-col gap-1 pt-2">
              <p className="flex h-6 items-center gap-1 px-2 text-xs font-medium text-muted">
                <ChevronRightIcon className="size-3" aria-hidden />
                Hidden columns
              </p>
              {folded.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setUnfolded([...unfolded, s.id])}
                  className="flex h-9 items-center gap-2 rounded-lg bg-sunken px-3 text-left text-[13px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <StatusIcon category={s.category} color={s.color} />
                  <span className="flex-1 truncate">{s.name}</span>
                  <span className="tabular-nums text-muted">{columns.tasks[s.id]?.length ?? 0}</span>
                </button>
              ))}
            </aside>
          ) : null}
        </div>
      </LayoutGroup>
    </MotionConfig>
  )
}
