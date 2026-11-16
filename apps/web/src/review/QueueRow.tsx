import { ChevronRightIcon } from "lucide-react"
import type { KeyboardEvent, ReactNode } from "react"

/** What useQueue hands each row: whether it's open, the keys, the focus. */
export interface QueueRowState {
  /** The row's key: the open one is in the URL (`?open=`), and the keys walk them in order. */
  readonly id: string
  readonly open: boolean
  /** The one row Tab lands on. */
  readonly tabbable: boolean
  /** Off while the keyboard moves between rows. */
  readonly hover: boolean
  readonly onToggle: () => void
  readonly onFocus: () => void
  readonly onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void
}

/**
 * One row of a queue page, the Review page's and the Agents page's (CEL-65): collapsed, a chevron, an
 * optional `lead` (an agent's mark), a `title` line, a `subtitle` line under it and a `badge` on the
 * right; open, `children` under a rule. `data` goes on the row, `buttonData` on its toggle (the pages'
 * own test hooks); the queue finds them by `data-queue-item` and `data-queue-row`.
 */
export function QueueRow({
  id,
  open,
  tabbable,
  hover,
  onToggle,
  onFocus,
  onKeyDown,
  headingId,
  bodyId,
  lead,
  title,
  subtitle,
  badge,
  data,
  buttonData,
  children,
}: QueueRowState & {
  readonly headingId: string
  readonly bodyId: string
  readonly lead?: ReactNode
  readonly title: ReactNode
  readonly subtitle: ReactNode
  readonly badge?: ReactNode
  readonly data?: Readonly<Record<`data-${string}`, string>>
  readonly buttonData?: Readonly<Record<`data-${string}`, string>>
  readonly children: ReactNode
}) {
  return (
    <article
      {...data}
      aria-labelledby={headingId}
      data-queue-item={id}
      data-open={open ? "" : undefined}
      className="scroll-my-4 rounded-lg border border-line bg-raised shadow-card data-open:border-line-strong"
    >
      <h2 id={headingId} className="text-[13px]">
        <button
          {...buttonData}
          type="button"
          data-queue-row={id}
          aria-expanded={open}
          aria-controls={open ? bodyId : undefined}
          tabIndex={tabbable ? 0 : -1}
          onClick={onToggle}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          className={`flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${hover ? "hover:bg-hover" : ""} ${open ? "rounded-t-lg" : "rounded-lg"}`}
        >
          <ChevronRightIcon
            aria-hidden
            className={`size-3.5 shrink-0 text-faint transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
          />
          {lead}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-baseline gap-2">{title}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">{subtitle}</span>
          </span>
          {badge}
        </button>
      </h2>
      {open ? (
        <div id={bodyId} className="flex flex-col gap-4 border-t border-line px-5 py-4">
          {children}
        </div>
      ) : null}
    </article>
  )
}
