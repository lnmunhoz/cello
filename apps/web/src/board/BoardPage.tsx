import { ORDERING_LABELS, orderTasks, type Ordering } from "@cello/client/sync/ordering"
import { boardColumns, projectByKey } from "@cello/client/sync/selectors"
import { stageStatus } from "@cello/shared/review"
import { needsInputFold } from "@cello/client/sync/asks"
import type { BoardState } from "@cello/client/sync/applyEvents"
import { progressOf } from "@cello/client/sync/milestones"
import type { Milestone, Project, Status, Task } from "@cello/contract/entities"
import { plainText } from "@cello/shared/document"
import { milestoneLanes, type MilestoneLane } from "@cello/shared/milestone"
import { useAtomSet } from "@effect/atom-react"
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { ChevronRightIcon, EyeOffIcon, MilestoneIcon, PlusIcon } from "lucide-react"
import { LayoutGroup, MotionConfig, motion } from "motion/react"
import { useEffect, useState, type ReactNode } from "react"
import { Centered } from "../app/Home.tsx"
import { Button } from "../components/ui/Button.tsx"
import { Chip } from "../components/ui/Chip.tsx"
import { toast } from "../components/ui/Toast.tsx"
import { groupingOf } from "../issues/layout.ts"
import { ProgressBar, ProgressNumbers } from "../milestones/parts.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { commands } from "../lib/cello.ts"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { layoutTransition } from "../lib/motion.ts"
import { readStored, writeStored } from "../lib/storage.ts"
import { useOrdering } from "../issues/useOrdering.ts"
import { type Filtered, useFiltered } from "../issues/useFilter.ts"
import { useTaskPlacement } from "../task/TaskPanel.tsx"
import { behindTask } from "../task/view.ts"
import { CardBody } from "./Card.tsx"
import { animator, useCursorVisual } from "./cursors/animator.ts"
import { withHoles, type Hole } from "./cursors/holes.ts"
import { useAgentCursors } from "./cursors/useAgentCursors.ts"
import { activityOf } from "../presence/Activity.tsx"
import { LaneHeading } from "../presence/Presence.tsx"
import { useNow } from "../presence/useNow.ts"
import { InlineCreate } from "./InlineCreate.tsx"
import { inLaneOrder, laneDrop, laneHeadings, laneInfo, taskLane, withLanes } from "./lanes.ts"
import { useStageLanes } from "./useStageLanes.ts"
import { useNeedsInputColumn } from "./needsInputColumn.ts"
import { Kanban, KanbanCard, KanbanColumn } from "./kanban.tsx"
import { dropOf, findMove, indexAmong } from "./moves.ts"
import { readUnfolded, unfoldedKey } from "./unfolded.ts"

/** The lane key of folded Needs input cards in a column split by stage. */
const WAITING_LANE = "needs-input"

/** A card's look, shared by the card and the copy an agent's waiting move leaves in its old slot. */
const CARD = "group flex flex-col gap-1.5 rounded-lg border border-line bg-raised px-3 py-2.5 shadow-card"

/**
 * A card an agent is at work on holds its edge (presence/Activity.tsx), so it's positioned; the others
 * aren't, since positioning all 200 slowed the agent cursors' flights (perf.spec).
 */
const ACTIVE_CARD = "relative"

/** A swimlane of the board under Grouping: Milestone (CEL-132), or the whole board as one lane (key ""). */
type Lane = MilestoneLane<Milestone>

const WHOLE_BOARD: Lane = { key: "", milestone: null, has: () => true }

/** A lane's column, as a list of the board's drag: the status id alone outside swimlanes. */
const listKey = (lane: Lane, statusId: string) => (lane.key === "" ? statusId : `${lane.key}|${statusId}`)

/** The lane and status a list key names. */
const laneOfList = (lanes: ReadonlyArray<Lane>, key: string): { lane: Lane; statusId: string } => {
  const bar = key.indexOf("|")
  if (bar === -1) return { lane: WHOLE_BOARD, statusId: key }
  return { lane: lanes.find((l) => l.key === key.slice(0, bar)) ?? WHOLE_BOARD, statusId: key.slice(bar + 1) }
}

const laneName = (lane: Lane) => lane.milestone?.name ?? "No milestone"

/** A card you just made (still optimistic) scrolls into view, wherever the ordering puts it. */
const reveal = (el: HTMLElement | null) => el?.scrollIntoView({ block: "nearest", inline: "nearest" })

export function BoardPage({ openNumber }: { openNumber?: number }) {
  const { projectKey } = useParams({ from: "/$projectKey" })
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  const project = board ? projectByKey(board, projectKey) : undefined
  const { ordering } = useOrdering()
  const filtered = useFiltered()
  if (!board || !workspaceId || !project) return <Centered>Loading…</Centered>
  return (
    <div className="flex min-h-0 flex-1">
      <Board key={project.id} board={board} workspaceId={workspaceId} project={project} ordering={ordering} openNumber={openNumber} filtered={filtered} />
    </div>
  )
}

function Board({
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
  /** The filter (CEL-52): every column stays, showing only the cards it keeps. */
  filtered: Filtered
}) {
  const { keep } = filtered
  const columns = boardColumns(board, workspaceId, project.id)
  // The hidden columns you unfolded, remembered on this device so a reload keeps them open.
  const [unfolded, setUnfoldedState] = useState<ReadonlyArray<string>>(() => readUnfolded(readStored(unfoldedKey(project.key))))
  const setUnfolded = (next: ReadonlyArray<string>) => {
    setUnfoldedState(next)
    writeStored(unfoldedKey(project.key), JSON.stringify(next))
  }
  // The list the `+` composer is open in (a column, or a column of a swimlane).
  const [composing, setComposing] = useState<string | null>(null)
  const move = useAtomSet(commands.moveTask)
  const setMilestone = useAtomSet(commands.setTaskMilestone)
  const grouping = groupingOf(useSearch({ from: "/$projectKey" }))
  const navigate = useNavigate()
  const placement = useTaskPlacement(openNumber !== undefined)
  const visual = useCursorVisual()
  useAgentCursors(project.id)
  // Display → "Group In Progress by stage": that one column shows a lane per stage (CEL-35).
  const lanesOn = useStageLanes()
  const lanedId = lanesOn ? (stageStatus([...columns.visible, ...columns.hidden])?.id ?? null) : null
  // A task's lane: its stage, else Working while an agent on it is active (CEL-105). The clock moves a
  // task out of Working once its agent goes quiet.
  const now = useNow()
  const laneKeyOf = (t: Task) => taskLane(board, t, now)

  // With the Needs input column off (the default), its cards sit at the bottom of In Progress, badged.
  const fold = needsInputFold([...columns.visible, ...columns.hidden], useNeedsInputColumn())
  const shown: Status[] = [...columns.visible, ...columns.hidden.filter((s) => unfolded.includes(s.id))].filter((s) => s.id !== fold?.from)
  const folded = columns.hidden.filter((s) => !unfolded.includes(s.id) && s.id !== fold?.from)
  // Each column's cards as shown: in the ordering. `columns.tasks` stays in the drag order, which placements need.
  const ordered = Object.fromEntries(shown.map((s) => {
    const own = orderTasks(keep(columns.tasks[s.id] ?? []), ordering)
    return [s.id, [
      // In the laned column (Display → Group In Progress by stage) its own cards go lane by lane (CEL-35).
      ...(s.id === lanedId ? inLaneOrder(own, laneKeyOf) : own),
      ...(s.id === fold?.into ? orderTasks(keep(columns.tasks[fold.from] ?? []), ordering) : []),
    ]]
  }))
  // How many cards a column holds without the filter, for "2 / 8".
  const totalOf = (id: string) => (columns.tasks[id]?.length ?? 0) + (id === fold?.into ? (columns.tasks[fold.from]?.length ?? 0) : 0)
  // Display → Grouping: Milestone (CEL-132): a swimlane per milestone, each with every column, No
  // milestone last. Otherwise one lane holds the whole board. Each lane's column is a list of its own.
  const swimlanes = grouping === "milestone"
    ? milestoneLanes(Object.values(board.milestones).filter((m) => m.projectId === project.id), Object.values(ordered).flat())
    : null
  const lanes: ReadonlyArray<Lane> = swimlanes ?? [WHOLE_BOARD]
  const inLane = (lane: Lane, statusId: string) => (ordered[statusId] ?? []).filter(lane.has)
  const lists = Object.fromEntries(lanes.flatMap((lane) => shown.map((s) => [listKey(lane, s.id), inLane(lane, s.id).map((t) => t.id)])))
  const labels = Object.fromEntries(lanes.flatMap((lane) => shown.map((s) => [listKey(lane, s.id), lane.key === "" ? s.name : `${laneName(lane)}, ${s.name}`])))

  const open = (task: Task) => {
    if (task.number > 0) void navigate({ to: "/$projectKey/$number", params: { projectKey: project.key, number: String(task.number) } })
  }

  const onListsChange = (next: Record<string, string[]>, details: unknown) => {
    const found = findMove(lists, next, (details as { key?: string } | null)?.key)
    if (!found) return
    const task = board.tasks[found.key]
    if (!task || task.number === 0) return
    const { lane, statusId } = laneOfList(lanes, found.to)
    const shownThere = next[found.to] ?? []
    // Into another milestone's swimlane (CEL-132): the card goes in that milestone, or out of every one
    // in No milestone. A closed milestone takes no tasks, so a drop there snaps back.
    const toMilestone = lane.key === "" || lane.has(task) ? undefined : (lane.milestone?.id ?? null)
    if (toMilestone !== undefined && lane.milestone?.state === "closed") {
      toast.error(`${lane.milestone.name} is closed: reopen it on its page to put tasks in it.`)
      return
    }
    if (toMilestone !== undefined) setMilestone({ id: task.id, milestoneId: toMilestone })
    const at = { ...found, to: statusId }
    // A folded Needs input card moved within In Progress stays where it is: only another column moves it.
    if (fold && task.statusId === fold.from && statusId === fold.into) return
    const target = (columns.tasks[statusId] ?? []).filter((t) => t.id !== task.id)
    // In the laned column a card stays in its stage's lane: a drop among another lane snaps back.
    // Folded cards sit below In Progress's own, which are all the placement counts.
    // The drop's index is among the cards shown; a filter (CEL-52) or a swimlane may hide some of the column's.
    const drop = statusId === lanedId
      ? laneDrop(at, shownThere, task.statusId, ordering, withLanes(columns.tasks[statusId] ?? [], laneKeyOf))
      : dropOf({ ...at, index: indexAmong(shownThere, at, target) }, task.statusId, ordering, target)
    if (drop) move({ id: task.id, ...drop })
  }

  // One column of one lane: its header with the count and `+`, the composer, and its cards.
  const column = (status: Status, lane: Lane, movingKey: string | null) => {
    const key = listKey(lane, status.id)
    const tasks = inLane(lane, status.id)
    const holes = visual.holes.filter((h) => h.statusId === status.id && lane.has(board.tasks[h.card] ?? {}))
    return (
      <section
        key={key}
        data-column={status.name}
        data-status-id={status.id}
        aria-labelledby={`col-${key}`}
        className={`flex w-[300px] shrink-0 flex-col rounded-lg bg-sunken ${swimlanes ? "" : "max-h-full"}`}
      >
        <header className="flex h-10 shrink-0 items-center gap-2 px-3">
          <StatusIcon category={status.category} color={status.color} />
          <h2 id={`col-${key}`} className="text-[13px] font-medium">
            {status.name}
          </h2>
          <span
            className="text-[13px] tabular-nums text-muted"
            aria-label={filtered.active && !swimlanes ? `${tasks.length} of ${totalOf(status.id)} tasks` : `${tasks.length} tasks`}
            data-column-count
          >
            {tasks.length}
            {filtered.active && !swimlanes ? <span className="text-faint"> / {totalOf(status.id)}</span> : null}
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
            {lane.milestone?.state === "closed" ? null : (
              <Button variant="ghost" size="icon" aria-label={`New task in ${status.name}`} data-column-plus onClick={() => setComposing(key)}>
                <PlusIcon className="size-3.5" />
              </Button>
            )}
          </span>
        </header>
        {composing === key ? (
          <div className="px-2 pb-1.5">
            <InlineCreate
              project={project}
              status={status}
              tasks={columns.tasks[status.id] ?? []}
              {...(lane.key === "" ? {} : { milestoneId: lane.milestone?.id ?? null })}
              onDone={() => setComposing(null)}
            />
          </div>
        ) : null}
        <KanbanColumn
          value={key}
          aria-labelledby={`col-${key}`}
          // Under a sorted order a drag changes the status only; hovering a column says so.
          title={ordering === "manual" ? undefined : `Sorted by ${ORDERING_LABELS[ordering]}. Dragging changes the status only; pick Manual in Display to reorder.`}
          data-ordering={ordering}
          className="flex min-h-16 flex-col gap-1.5 overflow-y-auto px-2 pb-2"
          // The column scrolls, so its cards' layout animations must account for its scroll offset.
          render={(props) => <motion.div {...(props as object)} layoutScroll />}
        >
          {({ cards }) => {
            const laned = status.id === lanedId
            // Folded Needs input cards (CEL-47) are a group of their own under the lanes.
            const laneOf = (id: string) => {
              const t = board.tasks[id]
              return t && t.statusId !== status.id ? WAITING_LANE : t ? laneKeyOf(t) : null
            }
            const headings = laned
              ? new Map([...laneHeadings(cards, laneOf, movingKey)].map(([i, h]) => [cards[i]!, h]))
              : null
            return withHoles(cards, holes).flatMap(({ key: id, hole }) => {
              const task = board.tasks[id]
              if (!task) return []
              if (hole) return [<HoleCard key={`hole-${hole.id}`} hole={hole} task={task} board={board} />]
              const heading = headings?.get(id)
              const stage = heading ? laneInfo(heading.stage) : null
              return [
                ...(heading
                  ? [<LaneHeading key={`lane-${heading.stage ?? "none"}`} stage={stage} waiting={heading.stage === WAITING_LANE} count={heading.count} />]
                  : []),
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
                  className={`${CARD} ${activityOf(board, task, Date.now()).busy ? ACTIVE_CARD : ""} cursor-grab outline-none hover:border-line-strong focus-visible:ring-2 focus-visible:ring-ring aria-[current=true]:border-accent data-dragging:border-dashed data-dragging:bg-transparent data-dragging:shadow-none data-dragging:*:invisible data-moving:not-data-dragging:ring-2 data-moving:not-data-dragging:ring-ring data-moving:not-data-dragging:shadow-pop`}
                  render={(props) => <motion.div {...(props as object)} layout="position" transition={layoutTransition} />}
                >
                  <CardBody task={task} board={board} laned={laned && task.statusId === status.id} />
                </KanbanCard>,
              ]
            })
          }}
        </KanbanColumn>
      </section>
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        {/* Its sideways scroll stays inside (no back swipe from its edge). In a narrow window an open task takes its place. */}
        <div data-agent-board data-grouping={grouping} className={`flex min-w-0 flex-1 gap-3 overflow-x-auto overscroll-x-contain px-3 pb-3 ${swimlanes ? "items-start overflow-y-auto" : ""} ${behindTask(placement)}`}>
          <Kanban
            lists={lists}
            onListsChange={onListsChange}
            labels={labels}
            order={lanes.flatMap((lane) => shown.map((s) => listKey(lane, s.id)))}
            aria-label={`${project.name} board`}
            className={swimlanes ? "flex flex-col gap-5" : "flex items-start gap-3"}
          >
            {({ movingKey }) => [
              <DragWatcher key="drag-watcher" movingKey={movingKey} />,
              ...(swimlanes
                ? swimlanes.map((lane) => (
                  <SwimlaneSection key={lane.key} lane={lane} board={board} workspaceId={workspaceId} project={project} count={shown.reduce((n, s) => n + inLane(lane, s.id).length, 0)}>
                    {shown.map((status) => column(status, lane, movingKey))}
                  </SwimlaneSection>
                ))
                : shown.map((status) => column(status, WHOLE_BOARD, movingKey))),
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
                  <span className="tabular-nums text-muted">{keep(columns.tasks[s.id] ?? []).length}</span>
                </button>
              ))}
            </aside>
          ) : null}
        </div>
      </LayoutGroup>
    </MotionConfig>
  )
}

/**
 * One swimlane under Grouping: Milestone (CEL-132): the milestone's name (opening its page), goal and
 * bar, or No milestone with its count, over a row of every column holding only its cards.
 */
function SwimlaneSection({ lane, board, workspaceId, project, count, children }: {
  lane: Lane
  board: BoardState
  workspaceId: string
  project: Project
  count: number
  children: ReactNode
}) {
  const m = lane.milestone
  const progress = m ? progressOf(board, workspaceId, project.id, m.id) : null
  return (
    <section data-lane={laneName(lane)} data-lane-key={lane.key} aria-label={`${laneName(lane)} swimlane`} className="flex flex-col gap-2">
      <header className="sticky left-0 flex h-8 w-fit max-w-[calc(100vw-4rem)] items-center gap-2 px-1 text-[13px]">
        <MilestoneIcon aria-hidden className="size-3.5 shrink-0 text-muted" />
        {m ? (
          <Link
            to="/$projectKey/milestones/$milestoneId"
            params={{ projectKey: project.key, milestoneId: m.id }}
            className="shrink-0 rounded-sm font-semibold text-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {m.name}
          </Link>
        ) : (
          <span className="shrink-0 font-semibold text-ink">No milestone</span>
        )}
        {m?.goal ? <span className="min-w-0 truncate text-muted">{plainText(m.goal)}</span> : null}
        {m?.state === "closed" ? <Chip size="sm">Closed</Chip> : null}
        {progress ? (
          <>
            <span className="flex w-28 shrink-0">
              <ProgressBar progress={progress} board={board} workspaceId={workspaceId} size="sm" />
            </span>
            <ProgressNumbers progress={progress} />
          </>
        ) : (
          <span className="shrink-0 text-xs tabular-nums text-muted">
            {count} {count === 1 ? "task" : "tasks"}
          </span>
        )}
      </header>
      <div className="flex items-start gap-3">{children}</div>
    </section>
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
