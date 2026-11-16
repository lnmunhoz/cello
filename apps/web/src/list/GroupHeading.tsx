import type { Status } from "@cello/contract/entities"
import { ChevronRightIcon } from "lucide-react"
import type { ReactNode } from "react"
import { StatusIcon } from "../components/ui/StatusIcon.tsx"

/**
 * A status group's band in a list of task rows (the list layout, a milestone's page): a button that
 * folds the group, with the status and its count ("2 / 8" when a filter shows `count` of `total`), then
 * `children` (the group's buttons). It sticks to the top while its rows scroll under it.
 */
export function GroupHeading({ status, folded, onToggle, count, total, children }: {
  status: Status
  folded: boolean
  onToggle: () => void
  count: number
  /** All of the group's tasks, when a filter shows only `count` of them. */
  total?: number
  children?: ReactNode
}) {
  return (
    <header className="sticky top-0 z-10 bg-surface">
      {/* A band a step off the page: recessed in light, raised in dark (as in Linear's list). */}
      <div className="flex h-9 items-center gap-2 rounded-md bg-sunken pr-1 pl-1 dark:bg-raised">
        <h2 id={`group-${status.id}`} className="flex min-w-0">
          <button
            type="button"
            aria-expanded={!folded}
            onClick={onToggle}
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
          aria-label={total === undefined ? `${count} tasks` : `${count} of ${total} tasks`}
          data-group-count
        >
          {count}
          {total === undefined ? null : <span className="text-faint"> / {total}</span>}
        </span>
        {children}
      </div>
    </header>
  )
}
