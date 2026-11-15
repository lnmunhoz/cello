import { ORDERING_LABELS, orderTasks, type Ordering } from "@cello/client/sync/ordering"
import { boardColumns, projectByKey } from "@cello/client/sync/selectors"
import { needsInputFold } from "@cello/client/sync/asks"
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Project, Status, Task } from "@cello/contract/entities"
import { useAtomSet } from "@effect/atom-react"
import { useNavigate, useParams } from "@tanstack/react-router"
import { ChevronRightIcon, EyeOffIcon, PlusIcon } from "lucide-react"
import { LayoutGroup, MotionConfig, motion } from "motion/react"
import { useEffect, useState } from "react"
import { Centered } from "../app/Home.tsx"
import { Button } from "../components/ui/Button.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { commands } from "../lib/cello.ts"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { readStored, writeStored } from "../lib/storage.ts"
import { useOrdering } from "../issues/useOrdering.ts"
import { useTaskView } from "../task/TaskPanel.tsx"
import { behindTask } from "../task/view.ts"
import { CardBody } from "./Card.tsx"
import { animator, useCursorVisual } from "./cursors/animator.ts"
import { withHoles, type Hole } from "./cursors/holes.ts"
import { useAgentCursors } from "./cursors/useAgentCursors.ts"
import { InlineCreate } from "./InlineCreate.tsx"
import { useNeedsInputColumn } from "./needsInputColumn.ts"
import { Kanban, KanbanCard, KanbanColumn } from "./kanban.tsx"
import { dropOf, findMove } from "./moves.ts"
import { readUnfolded, unfoldedKey } from "./unfolded.ts"

const layoutTransition = { type: "spring", stiffness: 520, damping: 42, mass: 0.7 } as const

/** A card's look, shared by the card and the copy an agent's waiting move leaves in its old slot. */
const CARD = "group flex flex-col gap-1.5 rounded-lg border border-line bg-raised px-3 py-2.5 shadow-card"

/** A card you just made (still optimistic) scrolls into view, wherever the ordering puts it. */
const reveal = (el: HTMLElement | null) => el?.scrollIntoView({ block: "nearest", inline: "nearest" })

export function BoardPage({ openNumber }: { openNumber?: number }) {
  const { projectKey } = useParams({ from: "/$projectKey" })
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  const project = board ? projectByKey(board, projectKey) : undefined
  const { ordering } = useOrdering()
  if (!board || !workspaceId || !project) return <Centered>Loading…</Centered>
  return (
    <div className="flex min-h-0 flex-1">
      <Board key={project.id} board={board} workspaceId={workspaceId} project={project} ordering={ordering} openNumber={openNumber} />
    </div>
  )
}

function Board({
  board,
  workspaceId,
  project,
  ordering,
  openNumber,
}: {
  board: BoardState
  workspaceId: string
  project: Project
  ordering: Ordering
  openNumber?: number
}) {
  const columns = boardColumns(board, workspaceId, project.id)
  // The hidden columns you unfolded, remembered on this device so a reload keeps them open.
  const [unfolded, setUnfoldedState] = useState<ReadonlyArray<string>>(() => readUnfolded(readStored(unfoldedKey(project.key))))
  const setUnfolded = (next: ReadonlyArray<string>) => {
    setUnfoldedState(next)
    writeStored(unfoldedKey(project.key), JSON.stringify(next))
  }
  const [composing, setComposing] = useState<string | null>(null)
  const move = useAtomSet(commands.moveTask)
  const navigate = useNavigate()
  const view = useTaskView()
  const visual = useCursorVisual()
  useAgentCursors(project.id)

  // With the Needs input column off (the default), its cards sit at the bottom of In Progress, badged.
  const fold = needsInputFold([...columns.visible, ...columns.hidden], useNeedsInputColumn())
  const shown: Status[] = [...columns.visible, ...columns.hidden.filter((s) => unfolded.includes(s.id))].filter((s) => s.id !== fold?.from)
  const folded = columns.hidden.filter((s) => !unfolded.includes(s.id) && s.id !== fold?.from)
  // Each column's cards as shown: in the ordering. `columns.tasks` stays in the drag order, which placements need.
  const ordered = Object.fromEntries(shown.map((s) => [s.id, [
    ...orderTasks(columns.tasks[s.id] ?? [], ordering),
    ...(s.id === fold?.into ? orderTasks(columns.tasks[fold.from] ?? [], ordering) : []),
  ]]))
  const lists = Object.fromEntries(shown.map((s) => [s.id, ordered[s.id]!.map((t) => t.id)]))
  const labels = Object.fromEntries(shown.map((s) => [s.id, s.name]))

  const open = (task: Task) => {
    if (task.number > 0) void navigate({ to: "/$projectKey/$number", params: { projectKey: project.key, number: String(task.number) } })
  }

  const onListsChange = (next: Record<string, string[]>, details: unknown) => {
    const found = findMove(lists, next, (details as { key?: string } | null)?.key)
    if (!found) return
    const task = board.tasks[found.key]
    if (!task || task.number === 0) return
    // A folded Needs input card moved within In Progress stays where it is: only another column moves it.
    if (fold && task.statusId === fold.from && found.to === fold.into) return
    const target = (columns.tasks[found.to] ?? []).filter((t) => t.id !== task.id)
    // Folded cards sit below In Progress's own, which are all the placement counts.
    const drop = dropOf({ ...found, index: Math.min(found.index, target.length) }, task.statusId, ordering, target)
    if (drop) move({ id: task.id, ...drop })
  }

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        {/* Its sideways scroll stays inside (no back swipe from its edge). In a narrow window an open task takes its place. */}
        <div data-agent-board className={`flex min-w-0 flex-1 gap-3 overflow-x-auto overscroll-x-contain px-3 pb-3 ${behindTask(openNumber !== undefined, view)}`}>
          <Kanban
            lists={lists}
            onListsChange={onListsChange}
            labels={labels}
            order={shown.map((s) => s.id)}
            aria-label={`${project.name} board`}
            className="flex items-start gap-3"
          >
            {({ movingKey }) => [
              <DragWatcher key="drag-watcher" movingKey={movingKey} />,
              ...shown.map((status) => {
                const tasks = ordered[status.id] ?? []
                const holes = visual.holes.filter((h) => h.statusId === status.id)
                return (
                  <section
                    key={status.id}
                    data-column={status.name}
                    data-status-id={status.id}
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
                        <Button variant="ghost" size="icon" aria-label={`New task in ${status.name}`} data-column-plus onClick={() => setComposing(status.id)}>
                          <PlusIcon className="size-3.5" />
                        </Button>
                      </span>
                    </header>
                    {composing === status.id ? (
                      <div className="px-2 pb-1.5">
                        <InlineCreate
                          project={project}
                          status={status}
                          tasks={columns.tasks[status.id] ?? []}
                          onDone={() => setComposing(null)}
                        />
                      </div>
                    ) : null}
                    <KanbanColumn
                      value={status.id}
                      aria-labelledby={`col-${status.id}`}
                      // Under a sorted order a drag changes the status only; hovering a column says so.
                      title={ordering === "manual" ? undefined : `Sorted by ${ORDERING_LABELS[ordering]}. Dragging changes the status only; pick Manual in Display to reorder.`}
                      data-ordering={ordering}
                      className="flex min-h-16 flex-col gap-1.5 overflow-y-auto px-2 pb-2"
                      // The column scrolls, so its cards' layout animations must account for its scroll offset.
                      render={(props) => <motion.div {...(props as object)} layoutScroll />}
                    >
                      {({ cards }) =>
                        withHoles(cards, holes).map(({ key: id, hole }) => {
                          const task = board.tasks[id]
                          if (!task) return null
                          if (hole) return <HoleCard key={`hole-${hole.id}`} hole={hole} task={task} board={board} />
                          return (
                            <KanbanCard
                              key={id}
                              value={id}
                              data-card-id={id}
                              data-task-key={task.key}
                              onPointerDownCapture={() => animator.grab(id)}
                              ref={task.number === 0 ? reveal : undefined}
                              aria-current={task.number === openNumber ? "true" : undefined}
                              onClick={() => open(task)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") open(task)
                              }}
                              className={`${CARD} cursor-grab outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring aria-[current=true]:border-accent data-dragging:border-dashed data-dragging:bg-transparent data-dragging:shadow-none data-dragging:*:invisible data-moving:not-data-dragging:ring-2 data-moving:not-data-dragging:ring-ring data-moving:not-data-dragging:shadow-pop`}
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
              }),
            ]}
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

/** Keyboard and pointer pickups reach the agent cursors here: while Lucas drags, they keep out of his way. */
function DragWatcher({ movingKey }: { movingKey: string | null }) {
  useEffect(() => {
    animator.setDragging(movingKey !== null)
    // Unmounted mid-drag (a route change during a keyboard pickup): the drag is over.
    return () => animator.setDragging(false)
  }, [movingKey])
  return null
}

/**
 * The copy of a card an agent's waiting move leaves in its old slot, so the card stays where Lucas saw
 * it until the cursor comes to carry it. Not a card: no key, no drag; pressing it lands the move at once.
 */
function HoleCard({ hole, task, board }: { hole: Hole; task: Task; board: BoardState }) {
  return (
    <motion.div
      layout="position"
      transition={layoutTransition}
      aria-hidden
      data-agent-hole={hole.id}
      data-agent-hole-card={hole.card}
      onPointerDown={() => animator.grab(hole.card)}
      className={CARD}
    >
      {/* As it was: its old column's status, until it lands in the new one. */}
      <CardBody task={{ ...task, statusId: hole.statusId }} board={board} />
    </motion.div>
  )
}
