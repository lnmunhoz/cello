import type { BoardState } from "@cello/client/sync/applyEvents"
import { reviewQueue, type ReviewItem } from "@cello/client/sync/reviews"
import { Link } from "@tanstack/react-router"
import { Breadcrumb } from "../app/Breadcrumb.tsx"
import { Centered } from "../app/Home.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { relativeTime } from "../lib/format.ts"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { ReviewActions } from "./ReviewActions.tsx"
import { ReviewPacket } from "./ReviewPacket.tsx"

/** Everything waiting on Lucas, across the workspace's projects, as one feed: review without opening tickets. */
export function ReviewPage() {
  const board = useBoard()
  const workspaceId = useWorkspaceId()
  if (!board || !workspaceId) return <Centered>Loading…</Centered>
  const queue = reviewQueue(board, workspaceId)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Breadcrumb crumbs={[{ label: board.workspaces[workspaceId]?.name ?? "Workspace" }, { label: "Review" }]} />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <header className="flex flex-col gap-0.5">
            <h1 className="text-[17px] font-semibold">
              Review <span className="font-normal text-muted tabular-nums">{queue.length}</span>
            </h1>
            <p className="text-[13px] text-muted">Approve to move a task to Done, or send it back with a note for the agent.</p>
          </header>
          {queue.length === 0 ? (
            <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-line px-6 py-14 text-center text-[13px] text-muted">
              <p className="text-[15px] font-medium text-ink">Nothing to review</p>
              <p>
                When an agent runs <code className="rounded bg-sunken px-1 py-0.5 text-[12px]">cello task submit</code>, its packet shows up here.
              </p>
            </div>
          ) : (
            <ul aria-label="Waiting for review" className="flex flex-col gap-6">
              {queue.map((item) => (
                <li key={item.task.id}>
                  <ReviewCard board={board} item={item} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

function ReviewCard({ board, item }: { board: BoardState; item: ReviewItem }) {
  const { task, project, review } = item
  const status = board.statuses[task.statusId]
  const headingId = `review-${task.id}`
  return (
    <article aria-labelledby={headingId} data-review-task={task.key} className="flex flex-col rounded-lg border border-line bg-raised shadow-card">
      <header className="flex items-center gap-2.5 border-b border-line px-5 py-3">
        <i aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: project.color }} />
        <h2 id={headingId} className="flex min-w-0 items-baseline gap-2 text-[13px]">
          <span className="shrink-0 tabular-nums text-muted">{task.key}</span>
          <Link
            to="/$projectKey/$number"
            params={{ projectKey: project.key, number: String(task.number) }}
            className="truncate font-semibold text-ink outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            {task.title}
          </Link>
        </h2>
        {status ? (
          <span className="ml-auto flex shrink-0 items-center gap-1.5 text-xs text-muted">
            <StatusIcon category={status.category} color={status.color} />
            {status.name}
          </span>
        ) : null}
      </header>
      <div className="px-5 py-4">
        {review ? (
          <ReviewPacket task={task} review={review} decide />
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-muted">No review packet: moved to {status?.name ?? "In Review"} by hand {relativeTime(task.updatedAt)}.</p>
            <ReviewActions task={task} />
          </div>
        )}
      </div>
    </article>
  )
}
