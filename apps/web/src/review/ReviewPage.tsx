import type { BoardState } from "@cello/client/sync/applyEvents"
import { needsInputQueue, type AskItem } from "@cello/client/sync/asks"
import { reviewQueue, type ReviewItem } from "@cello/client/sync/reviews"
import { projectsOf } from "@cello/client/sync/selectors"
import type { Project, Task } from "@cello/contract/entities"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { CheckIcon, CornerUpLeftIcon } from "lucide-react"
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react"
import { type ReactNode, useEffect, useEffectEvent, useState } from "react"
import { Breadcrumb } from "../app/Breadcrumb.tsx"
import { AskForm } from "../ask/AskView.tsx"
import { QuestionsBadge } from "../ask/QuestionsBadge.tsx"
import { Centered } from "../app/Home.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { relativeTime } from "../lib/format.ts"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { instant as motionInstant } from "../lib/motion.ts"
import { EvidenceBadge } from "./EvidenceBadge.tsx"
import { FOLD_SPRING, QueueRow, type QueueRowState } from "./QueueRow.tsx"
import { allLeft, type Decision, DECISION_LABEL, type DecisionEvent, decisionStep, filterQueue, type Held, holdStep, IDLE, REVIEW_SORT_LABELS, REVIEW_SORTS, sortQueue, syncHeld, withHeld } from "./queue.ts"
import { NothingFor, QueueToolbar } from "./ProjectChips.tsx"
import { projectChips } from "./queueView.ts"
import { useJustChanged, useQueueView } from "./useQueueView.ts"
import { CommentOrDecide } from "./ReviewActions.tsx"
import { ReviewPacket } from "./ReviewPacket.tsx"
import { useQueue } from "./useQueue.ts"
import { TaskLink } from "../task/TaskKey.tsx"
import { keepViewer } from "../viewer/search.ts"

/**
 * Everything waiting on Lucas, across the workspace's projects, one row per task: agents' questions first
 * (Needs your input, CEL-47), then review packets. One row is open at a time (`?open=CEL-12`): answer
 * or decide, and the next one opens, so the queue goes in order.
 *
 * A decision is answered on its row (CEL-187): the row says "Approved" or "Sent back" for a moment,
 * folds away, and the next one unfolds. The decided row is kept (`held`) for that moment, since the
 * events take it off the queue at once.
 */
export function ReviewPage() {
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  if (!board || !workspaceId) return <Centered>Loading…</Centered>
  return <ReviewQueue board={board} workspaceId={workspaceId} />
}

function ReviewQueue({ board, workspaceId }: { board: BoardState; workspaceId: string }) {
  const { open } = useSearch({ from: "/review" })
  const navigate = useNavigate({ from: "/review" })

  const projects = projectsOf(board, workspaceId)
  const { picked, pick, sort, pickSort, view } = useQueueView("review", projects, REVIEW_SORTS)
  // The human's own pick folds rows at once; an event's fold springs.
  const instant = useJustChanged(view)
  const projectId = picked?.id ?? null
  // Asks first (an agent is waiting on them), then packets; a task is in one group only. The chips count
  // all of them, so rows stay put while you filter (CEL-188).
  const allAsked = needsInputQueue(board, workspaceId)
  const allQueue = reviewQueue(board, workspaceId)
  const asked = sortQueue(filterQueue(allAsked, projectId), sort)
  const queue = filterQueue(allQueue, projectId)
  const chips = projectChips([...allAsked, ...allQueue].map((item) => item.project.id), projects, picked)
  const reduced = useReducedMotion() === true
  const [held, setHeld] = useState<ReadonlyArray<Held<ReviewItem>>>([])
  /** The row a decision opened: it unfolds. A row Lucas opens himself opens at once. */
  const [unfolding, setUnfolding] = useState<string | null>(null)
  // Held on the whole queue, so a row's place (`at`) doesn't move with the pick; the pick filters after, and keeps the held ones.
  const allPackets = withHeld(allQueue, (item) => item.task.key, held)
  const keepKeys = new Set(held.filter((h) => h.state.phase === "pending" || h.state.phase === "decided").map((h) => h.key))
  // A held row sorts by its frozen item, so it keeps its place until it folds away.
  const packets = sortQueue(filterQueue(allPackets, projectId, keepKeys), sort)
  const decisionOn = (key: string): Decision | null => {
    const state = held.find((h) => h.key === key)?.state
    return state?.phase === "decided" ? state.decision : null
  }
  const keys = [...asked, ...packets].map((item) => item.task.key)
  const openKey = open !== undefined && keys.includes(open) ? open : null
  // The viewer stays open beside the packet that changes.
  const setOpen = (key: string | null) => {
    setUnfolding(null)
    void navigate({ search: (prev) => ({ ...keepViewer(prev), ...(key === null ? {} : { open: key }) }), replace: true })
  }
  const rows = useQueue({ keys, open: openKey, setOpen })
  /** A pick that hides the open row closes it, so it doesn't spring open when the project comes back. */
  const onPick = (next: Project | null) => {
    pick(next)
    if (open === undefined || next === null) return
    const hidden = [...allAsked, ...allPackets].some((item) => item.task.key === open && item.project.id !== next.id && !keepKeys.has(open))
    if (hidden) setOpen(null)
  }

  /**
   * A decision on `item` as it goes. From the click its row is held where it stands, since the events
   * can take it off the queue before the command answers; taken, it says so; refused, it's let go (it
   * never left the queue).
   */
  const onDecision = (item: ReviewItem, event: DecisionEvent) => {
    const key = item.task.key
    if (event.type !== "clicked") return setHeld((rows) => holdStep(rows, key, event))
    const at = allPackets.findIndex((p) => p.task.key === key)
    const state = decisionStep(IDLE, event)
    setHeld((rows) => [...rows.filter((h) => h.key !== key), { key, item, at: at === -1 ? allPackets.length : at, state, dropped: false }])
  }
  // The held rows follow the queue: a row the events took off it is noted, and one that comes back (a new packet) is let go.
  const listed = allQueue.map((item) => item.task.key)
  const listedKeys = listed.join(" ")
  const followQueue = useEffectEvent(() => setHeld((rows) => syncHeld(rows, listed)))
  useEffect(() => followQueue(), [listedKeys])
  /** The row has said so for its moment: it folds away, and the next one opens, unless Lucas opened another meanwhile. */
  const shown = (key: string) => {
    // Nothing folds with reduced motion: out of the list, the row has left.
    setHeld((rows) => (reduced ? holdStep(holdStep(rows, key, { type: "shown" }), key, { type: "left" }) : holdStep(rows, key, { type: "shown" })))
    if (openKey === key) setUnfolding(rows.openNext(key))
  }
  /** The rows that were leaving have folded away. */
  const left = () => setHeld(allLeft)
  const leavingKeys = held.filter((h) => h.state.phase === "leaving").map((h) => h.key).join(" ")
  const leaving = leavingKeys !== ""
  // The fold's end (onExitComplete) isn't the only word on it: it never comes in a hidden tab, or for a row
  // that came back mid-fold. A timer says so too, well after the spring has settled.
  useEffect(() => {
    if (leavingKeys === "") return
    const timer = setTimeout(() => setHeld(allLeft), FOLD_FALLBACK_MS)
    return () => clearTimeout(timer)
  }, [leavingKeys])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Breadcrumb crumbs={[{ label: board.workspaces[workspaceId]?.name ?? "Workspace" }, { label: "Review" }]} />
      {/* A packet container (index.css), measured on the whole panel, so the padding sits inside: on a
          wide panel the rows widen and the open packet splits in two. */}
      <div data-review-scroller="" className="@container/packet flex-1 overflow-y-auto py-6">
        <div className="packet-column flex flex-col gap-6">
          <header className="flex flex-col gap-0.5">
            <h1 className="text-[17px] font-semibold">
              Review <span className="font-normal text-muted tabular-nums">{asked.length + queue.length}</span>
            </h1>
            <p className="text-[13px] text-muted">
              Answer the agents' questions first, then open a packet: comment on it, approve it to move the task to Done, or send it back
              with a note for the agent. ↑ ↓ or j k move between rows, Enter opens, Esc closes.
            </p>
          </header>
          <QueueToolbar chips={chips} picked={picked} onPick={onPick} sort={sort} sorts={REVIEW_SORTS} labels={REVIEW_SORT_LABELS} onSort={pickSort} />
          {/* Both groups are one list for the keys: ↑ ↓ go from the last ask to the first packet. */}
          <div {...rows.list} className="flex flex-col gap-6">
            {asked.length > 0 ? (
              <section aria-labelledby="needs-input-heading" className="flex flex-col gap-2">
                <h2 id="needs-input-heading" className="flex items-center gap-2 text-[13px] font-semibold text-ink">
                  <i aria-hidden className="size-1.5 rounded-full bg-accent" />
                  Needs your input <span className="font-normal text-muted tabular-nums">{asked.length}</span>
                </h2>
                <ul aria-label="Needs your input" className="flex flex-col gap-2">
                  {asked.map((item) => (
                    <li key={item.task.id}>
                      <AskRow
                        {...rows.row(item.task.key)}
                        unfold={item.task.key === unfolding}
                        board={board}
                        item={item}
                        onAnswered={() => void rows.openNext(item.task.key)}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {/* The list stays while its last row folds away. */}
            {packets.length === 0 && !leaving ? (
              asked.length === 0 && picked !== null ? (
                <NothingFor project={picked} onShowAll={() => onPick(null)} />
              ) : asked.length === 0 ? (
                <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-line px-6 py-14 text-center text-[13px] text-muted">
                  <p className="text-[15px] font-medium text-ink">Nothing to review</p>
                  <p>
                    When an agent asks you something with <code className="rounded bg-sunken px-1 py-0.5 text-[12px]">cello task ask</code> or hands
                    in work with <code className="rounded bg-sunken px-1 py-0.5 text-[12px]">cello task submit</code>, it shows up here.
                  </p>
                </div>
              ) : null
            ) : (
              <section aria-labelledby={asked.length > 0 ? "packets-heading" : undefined} className="flex flex-col gap-2">
                {asked.length > 0 ? (
                  <h2 id="packets-heading" className="text-[13px] font-semibold text-ink">
                    Packets <span className="font-normal text-muted tabular-nums">{queue.length}</span>
                  </h2>
                ) : null}
                <ul aria-label="Waiting for review" className="flex flex-col gap-2">
                  <AnimatePresence initial={false} onExitComplete={left} custom={instant}>
                    {packets.map((item) => {
                      const key = item.task.key
                      const decision = decisionOn(key)
                      return (
                        <FoldAway key={item.task.id} instant={instant}>
                          <ReviewRow
                            {...rows.row(key)}
                            unfold={key === unfolding}
                            confirmation={decision === null ? undefined : <Decided decision={decision} onShown={() => shown(key)} />}
                            board={board}
                            item={item}
                            onDecision={(event) => onDecision(item, event)}
                          />
                        </FoldAway>
                      )
                    })}
                  </AnimatePresence>
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** How long a row says "Approved" or "Sent back" before it folds away: long enough to read two words. */
const CONFIRMATION_MS = 1100

/** When a folding row counts as gone, whether or not its fold reported its end: several times the spring's length. */
const FOLD_FALLBACK_MS = 1500

/** What a decided row says in its badge's place, for a moment; then `onShown` runs. */
function Decided({ decision, onShown }: { decision: Decision; onShown: () => void }) {
  const done = useEffectEvent(onShown)
  useEffect(() => {
    const timer = setTimeout(() => done(), CONFIRMATION_MS)
    return () => clearTimeout(timer)
  }, [])
  const Icon = decision === "approved" ? CheckIcon : CornerUpLeftIcon
  return (
    <span role="status" data-decided={decision} className={`flex shrink-0 items-center gap-1.5 text-[13px] font-medium ${decision === "approved" ? "text-answered" : "text-ink"}`}>
      <Icon aria-hidden className="size-3.5" />
      {DECISION_LABEL[decision]}
    </span>
  )
}

/** How a packet folds away: on the spring, or at once when the human's pick took it off the page (AnimatePresence's custom). */
const FOLD = { fold: (instant: boolean | undefined) => ({ height: 0, opacity: 0, marginBottom: -8, transition: instant ? motionInstant : FOLD_SPRING }) }

/** A packet's place in the list: when its row leaves the queue it folds away, so the rows under it glide up. With reduced motion it just goes. */
function FoldAway({ instant, children }: { instant: boolean; children: ReactNode }) {
  const present = useIsPresent()
  const reduced = useReducedMotion() === true
  return (
    // The margin takes the list's gap (gap-2) with it. It clips only while it folds: a focus ring and the card's shadow reach past it.
    <motion.li {...(reduced ? {} : { exit: "fold", custom: instant, variants: FOLD })} className={present ? undefined : "overflow-hidden"}>
      {children}
    </motion.li>
  )
}

type RowProps = QueueRowState & { readonly board: BoardState }

/**
 * One waiting task in the queue: collapsed, its key, title, project and `subtitle`, with `badge` on the
 * right; open, its status, a link to the task and `children` (a packet, or questions to answer).
 */
function TaskQueueRow({
  board,
  task,
  project,
  subtitle,
  badge,
  children,
  ...row
}: RowProps & { task: Task; project: Project; subtitle: string; badge: ReactNode; children: ReactNode }) {
  const status = board.statuses[task.statusId]
  return (
    <QueueRow
      {...row}
      headingId={`review-${task.id}`}
      bodyId={`review-packet-${task.id}`}
      data={{ "data-review-task": task.key }}
      buttonData={{ "data-review-row": task.key }}
      title={
        <>
          <span className="shrink-0 tabular-nums text-muted">{task.key}</span>
          <span className="truncate font-semibold text-ink">{task.title}</span>
        </>
      }
      subtitle={
        <>
          <i aria-hidden className="size-2 shrink-0 rounded-[3px]" style={{ background: project.color }} />
          <span className="truncate">
            {project.name} · {subtitle}
          </span>
        </>
      }
      badge={badge}
    >
      <div className="flex items-center gap-3 text-xs text-muted">
        {status ? (
          <span className="flex items-center gap-1.5">
            <StatusIcon category={status.category} color={status.color} />
            {status.name}
          </span>
        ) : null}
        {/* In this page's side panel, beside the queue (CEL-141); ⌘-click opens it on its board in a new tab.
            The row is the task in view, so no hover card about it (CEL-142). */}
        <TaskLink
          taskKey={task.key}
          preview={false}
          className="ml-auto rounded-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          Open {task.key}
        </TaskLink>
      </div>
      {children}
    </QueueRow>
  )
}

/**
 * A task waiting for review: collapsed, who submitted it and when, and its evidence; open, its packet,
 * then the task's comments with a comment box, Send back and Approve (CEL-70).
 */
function ReviewRow({ item, onDecision, ...row }: RowProps & { item: ReviewItem; onDecision: (event: DecisionEvent) => void }) {
  const { task, project, review } = item
  const byHand = `moved to ${row.board.statuses[task.statusId]?.name ?? "In Review"} by hand`
  return (
    <TaskQueueRow
      {...row}
      task={task}
      project={project}
      subtitle={review ? `${review.author.name} · ${relativeTime(review.createdAt)}` : `${byHand} · ${relativeTime(task.updatedAt)}`}
      badge={<EvidenceBadge task={task} board={row.board} size="md" />}
    >
      {review ? (
        <ReviewPacket task={task} review={review} decide onDecision={onDecision} comments={row.board} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-muted">
            No review packet: {byHand} {relativeTime(task.updatedAt)}.
          </p>
          <CommentOrDecide board={row.board} task={task} onDecision={onDecision} />
        </div>
      )}
    </TaskQueueRow>
  )
}

/** A task waiting on Lucas's answers (CEL-47): collapsed, who asked what and when; open, the questions to answer, beside the evidence. */
function AskRow({ item, onAnswered, ...row }: RowProps & { item: AskItem; onAnswered: () => void }) {
  const { task, project, ask } = item
  return (
    <TaskQueueRow
      {...row}
      task={task}
      project={project}
      subtitle={`${ask.author.name} asks: ${ask.title} · ${relativeTime(ask.createdAt)}`}
      badge={<QuestionsBadge task={task} board={row.board} count />}
    >
      <AskForm task={task} ask={ask} onAnswered={onAnswered} />
    </TaskQueueRow>
  )
}
