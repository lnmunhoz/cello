import type { BoardState } from "@cello/client/sync/applyEvents"
import { reviewQueue, type ReviewItem } from "@cello/client/sync/reviews"
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ChevronRightIcon } from "lucide-react"
import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { Breadcrumb } from "../app/Breadcrumb.tsx"
import { Centered } from "../app/Home.tsx"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"
import { relativeTime } from "../lib/format.ts"
import { useBoard, useWorkspaceId } from "../lib/hooks.ts"
import { nextRow } from "../list/rows.ts"
import { EvidenceBadge } from "./EvidenceBadge.tsx"
import { nextAfterDecision, rowKey } from "./queue.ts"
import { ReviewActions } from "./ReviewActions.tsx"
import { ReviewPacket } from "./ReviewPacket.tsx"

/**
 * Everything waiting on Lucas, across the workspace's projects, one row per task. One row is open at
 * a time (`?open=CEL-12`): read its packet, decide, and the next one opens, so the queue goes in order.
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
  const listRef = useRef<HTMLUListElement>(null)
  const [focused, setFocused] = useState<string | null>(null)
  /** Set by a decision: the row it opens takes the focus, so the keys go on working. */
  const focusOpened = useRef(false)

  const queue = reviewQueue(board, workspaceId)
  const keys = queue.map((item) => item.task.key)
  const openKey = open !== undefined && keys.includes(open) ? open : null
  // The one row Tab lands on; the arrow keys and j/k move it.
  const tabbable = focused !== null && keys.includes(focused) ? focused : (openKey ?? keys[0] ?? null)

  const headerOf = (key: string) => listRef.current?.querySelector<HTMLElement>(`[data-review-row="${CSS.escape(key)}"]`)
  const setOpen = (key: string | null) => void navigate({ search: key === null ? {} : { open: key }, replace: true })
  const focusRow = (key: string) => {
    setFocused(key)
    headerOf(key)?.focus()
  }

  // The row that opens comes into view, whether a click, a key, a decision or a link (?open=) opened it.
  useEffect(() => {
    if (openKey === null) return
    listRef.current?.querySelector(`[data-review-task="${CSS.escape(openKey)}"]`)?.scrollIntoView({ block: "nearest" })
    if (focusOpened.current) {
      focusOpened.current = false
      headerOf(openKey)?.focus()
    }
  }, [openKey])

  // With nothing focused (the page just opened, or a decision took the focus away): j/k start from
  // the open row or the first, and Esc closes the open row.
  useEffect(() => {
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.target !== document.body || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === "Escape" && openKey !== null) {
        void navigate({ search: {}, replace: true })
      } else if ((e.key === "j" || e.key === "k") && tabbable !== null) {
        e.preventDefault()
        setFocused(tabbable)
        headerOf(tabbable)?.focus()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [openKey, tabbable, navigate])

  const onRowKeyDown = (e: KeyboardEvent<HTMLButtonElement>, key: string) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    if (e.key === "Enter") {
      e.preventDefault()
      setOpen(key)
      return
    }
    const next = nextRow(keys, key, rowKey(e.key))
    if (next === null) return
    e.preventDefault()
    focusRow(next)
  }

  // Esc closes the open row from anywhere in the list, and its row takes the focus. Not while typing,
  // nor from a dialog (portaled out of the list), which Esc closes first.
  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const target = e.target as HTMLElement
    if (e.key !== "Escape" || openKey === null || e.defaultPrevented || !e.currentTarget.contains(target)) return
    if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
    e.preventDefault()
    setOpen(null)
    focusRow(openKey)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Breadcrumb crumbs={[{ label: board.workspaces[workspaceId]?.name ?? "Workspace" }, { label: "Review" }]} />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-6">
          <header className="flex flex-col gap-0.5">
            <h1 className="text-[17px] font-semibold">
              Review <span className="font-normal text-muted tabular-nums">{queue.length}</span>
            </h1>
            <p className="text-[13px] text-muted">
              Open a packet, then approve it to move the task to Done, or send it back with a note for the agent. ↑ ↓ or j k move between
              rows, Enter opens, Esc closes.
            </p>
          </header>
          {queue.length === 0 ? (
            <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-line px-6 py-14 text-center text-[13px] text-muted">
              <p className="text-[15px] font-medium text-ink">Nothing to review</p>
              <p>
                When an agent runs <code className="rounded bg-sunken px-1 py-0.5 text-[12px]">cello task submit</code>, its packet shows up here.
              </p>
            </div>
          ) : (
            <ul ref={listRef} aria-label="Waiting for review" className="flex flex-col gap-2" onKeyDown={onListKeyDown}>
              {queue.map((item) => {
                const key = item.task.key
                const isOpen = key === openKey
                return (
                  <li key={item.task.id}>
                    <ReviewRow
                      board={board}
                      item={item}
                      open={isOpen}
                      tabbable={key === tabbable}
                      onToggle={() => setOpen(isOpen ? null : key)}
                      onFocus={() => setFocused(key)}
                      onKeyDown={(e) => onRowKeyDown(e, key)}
                      onDecided={() => {
                        const next = nextAfterDecision(keys, key)
                        focusOpened.current = next !== undefined
                        setOpen(next ?? null)
                      }}
                    />
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

interface ReviewRowProps {
  readonly board: BoardState
  readonly item: ReviewItem
  readonly open: boolean
  readonly tabbable: boolean
  readonly onToggle: () => void
  readonly onFocus: () => void
  readonly onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
  readonly onDecided: () => void
}

/**
 * A waiting task: collapsed, its key, title, project, who submitted it and when, and its evidence;
 * open, its packet with Approve and Send back.
 */
function ReviewRow({ board, item, open, tabbable, onToggle, onFocus, onKeyDown, onDecided }: ReviewRowProps) {
  const { task, project, review } = item
  const status = board.statuses[task.statusId]
  const headingId = `review-${task.id}`
  const bodyId = `review-packet-${task.id}`
  const byHand = `moved to ${status?.name ?? "In Review"} by hand`
  return (
    <article
      aria-labelledby={headingId}
      data-review-task={task.key}
      data-open={open ? "" : undefined}
      className="scroll-my-4 rounded-lg border border-line bg-raised shadow-card data-open:border-line-strong"
    >
      <h2 id={headingId} className="text-[13px]">
        <button
          type="button"
          data-review-row={task.key}
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          tabIndex={tabbable ? 0 : -1}
          onClick={onToggle}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring ${open ? "rounded-t-lg" : "rounded-lg"}`}
        >
          <ChevronRightIcon
            aria-hidden
            className={`size-3.5 shrink-0 text-faint transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="shrink-0 tabular-nums text-muted">{task.key}</span>
              <span className="truncate font-semibold text-ink">{task.title}</span>
            </span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">
              <i aria-hidden className="size-2 shrink-0 rounded-[3px]" style={{ background: project.color }} />
              <span className="truncate">
                {project.name} · {review ? `${review.author.name} · ${relativeTime(review.createdAt)}` : `${byHand} · ${relativeTime(task.updatedAt)}`}
              </span>
            </span>
          </span>
          <EvidenceBadge task={task} board={board} size="md" />
        </button>
      </h2>
      {open ? (
        <div id={bodyId} className="flex flex-col gap-4 border-t border-line px-5 py-4">
          <div className="flex items-center gap-3 text-xs text-muted">
            {status ? (
              <span className="flex items-center gap-1.5">
                <StatusIcon category={status.category} color={status.color} />
                {status.name}
              </span>
            ) : null}
            <Link
              to="/$projectKey/$number"
              params={{ projectKey: project.key, number: String(task.number) }}
              className="ml-auto rounded-sm font-medium text-accent outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open {task.key}
            </Link>
          </div>
          {review ? (
            <ReviewPacket task={task} review={review} decide onDecided={onDecided} />
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[13px] text-muted">
                No review packet: {byHand} {relativeTime(task.updatedAt)}.
              </p>
              <ReviewActions task={task} onDecided={onDecided} />
            </div>
          )}
        </div>
      ) : null}
    </article>
  )
}
