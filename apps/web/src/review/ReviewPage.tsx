import type { BoardState } from "@cello/client/sync/applyEvents"
import { needsInputQueue, type AskItem } from "@cello/client/sync/asks"
import { reviewQueue, type ReviewItem } from "@cello/client/sync/reviews"
import type { Project, Task } from "@cello/contract/entities"
import { useNavigate, useSearch } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { Breadcrumb } from "../app/Breadcrumb.tsx"
import { AskForm } from "../ask/AskView.tsx"
import { QuestionsBadge } from "../ask/QuestionsBadge.tsx"
import { Centered } from "../app/Home.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { relativeTime } from "../lib/format.ts"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { EvidenceBadge } from "./EvidenceBadge.tsx"
import { QueueRow, type QueueRowState } from "./QueueRow.tsx"
import { CommentOrDecide } from "./ReviewActions.tsx"
import { ReviewPacket } from "./ReviewPacket.tsx"
import { useQueue } from "./useQueue.ts"
import { TaskLink } from "../task/TaskKey.tsx"
import { keepViewer } from "../viewer/search.ts"

/**
 * Everything waiting on Lucas, across the workspace's projects, one row per task: agents' questions first
 * (Needs your input, CEL-47), then review packets. One row is open at a time (`?open=CEL-12`): answer
 * or decide, and the next one opens, so the queue goes in order.
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

  // Asks first (an agent is waiting on them), then packets; a task is in one group only.
  const asked = needsInputQueue(board, workspaceId)
  const queue = reviewQueue(board, workspaceId)
  const keys = [...asked, ...queue].map((item) => item.task.key)
  const openKey = open !== undefined && keys.includes(open) ? open : null
  const rows = useQueue({
    keys,
    open: openKey,
    // The viewer stays open beside the packet that changes.
    setOpen: (key) => void navigate({ search: (prev) => ({ ...keepViewer(prev), ...(key === null ? {} : { open: key }) }), replace: true }),
  })

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
                      <AskRow {...rows.row(item.task.key)} board={board} item={item} onAnswered={() => rows.openNext(item.task.key)} />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {queue.length === 0 ? (
              asked.length === 0 ? (
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
                  {queue.map((item) => (
                    <li key={item.task.id}>
                      <ReviewRow {...rows.row(item.task.key)} board={board} item={item} onDecided={() => rows.openNext(item.task.key)} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
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
function ReviewRow({ item, onDecided, ...row }: RowProps & { item: ReviewItem; onDecided: () => void }) {
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
        <ReviewPacket task={task} review={review} decide onDecided={onDecided} comments={row.board} />
      ) : (
        <div className="flex flex-col gap-4">
          <p className="text-[13px] text-muted">
            No review packet: {byHand} {relativeTime(task.updatedAt)}.
          </p>
          <CommentOrDecide board={row.board} task={task} onDecided={onDecided} />
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
