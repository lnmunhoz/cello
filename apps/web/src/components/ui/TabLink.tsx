import { Link, type LinkProps } from "@tanstack/react-router"
import type { ReactNode } from "react"

/** A route tab, like Overview / Issues. The active route gets the selected look. */
export function TabLink({ forceActive, ...props }: LinkProps & { children: ReactNode; forceActive?: boolean }) {
  return (
    <Link
      {...props}
      inactiveProps={forceActive ? ({ "data-status": "active" } as object) : {}}
      className="inline-flex h-7 items-center rounded-full border border-transparent px-3 text-[13px] font-medium text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring data-[status=active]:border-line data-[status=active]:bg-raised data-[status=active]:text-ink data-[status=active]:shadow-card"
    />
  )
}
