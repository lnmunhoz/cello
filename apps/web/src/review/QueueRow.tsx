import { ChevronRightIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from "react"
import { spring } from "../lib/motion.ts"

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
  /**
   * What was just decided on this row (CEL-187), shown in the badge's place: the row folds shut under
   * it and comes into view, so the words are seen before the row leaves. It sits beside the row's
   * toggle, not inside it, so it can hold a button (Undo, CEL-191); the body stays mounted while it shows,
   * so a decision's buttons keep their state (a failure line) whether or not the row was left open.
   */
  readonly confirmation?: ReactNode | undefined
  /** This row opened because the one before it was decided: it unfolds instead of popping open. */
  readonly unfold?: boolean | undefined
}

/** The spring a row folds and unfolds with: the app's one spring (lib/motion.ts). */
export const FOLD_SPRING = spring

const FOLDED = { height: 0, opacity: 0 } as const

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
  confirmation,
  unfold = false,
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
  const decided = confirmation !== undefined
  const expanded = open && !decided
  const reduced = useReducedMotion() === true
  const heading = useRef<HTMLHeadingElement>(null)
  // Approve sits at the foot of a long packet: the row's head, which now says what was decided, comes into view.
  useEffect(() => {
    if (decided) heading.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" })
  }, [decided, reduced])
  return (
    <article
      {...data}
      aria-labelledby={headingId}
      data-queue-item={id}
      data-open={expanded ? "" : undefined}
      className="scroll-my-4 rounded-lg border border-line bg-raised shadow-card data-open:border-line-strong"
    >
      <h2 ref={heading} id={headingId} className="relative flex items-center scroll-my-4 text-[13px]">
        <button
          {...buttonData}
          type="button"
          data-queue-row={id}
          aria-expanded={expanded}
          aria-controls={expanded ? bodyId : undefined}
          tabIndex={tabbable ? 0 : -1}
          onClick={onToggle}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          className={`flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring ${hover && !decided ? "hover:bg-hover" : ""} ${expanded ? "rounded-t-lg" : "rounded-lg"}`}
        >
          <ChevronRightIcon
            aria-hidden
            className={`size-3.5 shrink-0 text-faint transition-transform duration-150 motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}
          />
          {lead}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="flex min-w-0 items-baseline gap-2">{title}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted">{subtitle}</span>
          </span>
          {decided ? null : badge}
        </button>
        {decided ? <div className="flex shrink-0 items-center pr-4 pl-3">{confirmation}</div> : null}
      </h2>
      {open || decided ? (
        <QueueRowBody id={bodyId} unfold={unfold && !reduced} folded={decided} reduced={reduced}>
          {children}
        </QueueRowBody>
      ) : null}
    </article>
  )
}

/**
 * An open row's body. A click opens and closes it at once. It moves only for a decision (CEL-187):
 * decided, it folds shut (`folded`) while the row says so; the next row's unfolds (`unfold`). It clips
 * only while it moves: a packet's evidence column is sticky, which a clipping parent would stop.
 */
function QueueRowBody({ id, unfold, folded, reduced, children }: { id: string; unfold: boolean; folded: boolean; reduced: boolean; children: ReactNode }) {
  const [unfolding, setUnfolding] = useState(unfold)
  return (
    <motion.div
      initial={unfolding ? FOLDED : false}
      animate={folded ? FOLDED : { height: "auto", opacity: 1 }}
      transition={reduced ? { duration: 0 } : FOLD_SPRING}
      onAnimationComplete={() => setUnfolding(false)}
      inert={folded}
      className={unfolding || folded ? "overflow-hidden" : undefined}
    >
      <div id={id} className="flex flex-col gap-4 border-t border-line px-5 py-4">
        {children}
      </div>
    </motion.div>
  )
}
