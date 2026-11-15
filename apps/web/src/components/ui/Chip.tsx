import type { ReactNode } from "react"
import { variants, type VariantProps } from "./variants.ts"

const chip = variants(
  "inline-flex h-5.5 max-w-full items-center gap-1.5 rounded-full border border-line px-2 text-xs whitespace-nowrap text-muted",
  { size: { sm: "h-5 px-1.5 text-[11px]", md: "" } },
  { size: "md" },
)

/** A label or property shown as a pill, with an optional colored dot. */
export function Chip({ color, icon, children, size }: { color?: string; icon?: ReactNode; children: ReactNode } & VariantProps<typeof chip>) {
  return (
    <span className={chip({ size })}>
      {color ? <i className="size-2 shrink-0 rounded-full" style={{ background: color }} /> : icon}
      <span className="truncate">{children}</span>
    </span>
  )
}
