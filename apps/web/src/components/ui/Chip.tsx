import { XIcon } from "lucide-react"
import type { ReactNode } from "react"
import { variants, type VariantProps } from "./variants.ts"

const chip = variants(
  "inline-flex h-5.5 max-w-full items-center gap-1.5 rounded-full border border-line px-2 text-xs whitespace-nowrap text-muted",
  {
    size: { sm: "h-5 px-1.5 text-[11px]", md: "" },
    /** `filter`: an active filter above the board, removable (CEL-52 scope). */
    tone: { quiet: "", filter: "h-6 bg-raised pr-0.5 text-ink shadow-card" },
  },
  { size: "md", tone: "quiet" },
)

/** A label or property shown as a pill, with an optional colored dot, and an × when it can be removed. */
export function Chip({ color, icon, children, size, tone, prefix, onRemove, removeLabel }: {
  color?: string
  icon?: ReactNode
  children: ReactNode
  /** Quiet words before the value: the property ("Priority"). */
  prefix?: string | null
  onRemove?: () => void
  removeLabel?: string
} & VariantProps<typeof chip>) {
  return (
    <span className={chip({ size, tone })}>
      {color ? <i className="size-2 shrink-0 rounded-full" style={{ background: color }} /> : icon}
      {prefix ? <span className="text-muted">{prefix}</span> : null}
      <span className="truncate">{children}</span>
      {onRemove ? (
        <button
          type="button"
          aria-label={removeLabel ?? "Remove"}
          onClick={onRemove}
          className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
        >
          <XIcon aria-hidden className="size-3" />
        </button>
      ) : null}
    </span>
  )
}
