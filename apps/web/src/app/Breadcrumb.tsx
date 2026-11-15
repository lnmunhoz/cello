import { Link, type LinkProps } from "@tanstack/react-router"
import { ChevronRightIcon } from "lucide-react"
import type { ReactNode } from "react"
import { ShowSidebarButton } from "./Sidebar.tsx"

export interface Crumb {
  readonly label: ReactNode
  readonly link?: LinkProps
}

/** The page's top bar: where you are, and the button that brings back a hidden sidebar. */
export function Breadcrumb({ crumbs }: { crumbs: ReadonlyArray<Crumb> }) {
  return (
    <div className="flex h-11 shrink-0 items-center gap-1 border-b border-line pr-4 pl-2">
      <ShowSidebarButton />
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 px-2 text-[13px]">
        {crumbs.map((c, i) => (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            {i > 0 ? <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-faint" /> : null}
            {c.link && i < crumbs.length - 1 ? (
              <Link {...c.link} className="truncate font-medium text-muted hover:text-ink">
                {c.label}
              </Link>
            ) : (
              <span aria-current={i === crumbs.length - 1 ? "page" : undefined} className="truncate font-medium text-ink">
                {c.label}
              </span>
            )}
          </span>
        ))}
      </nav>
    </div>
  )
}
