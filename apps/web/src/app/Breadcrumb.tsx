import { Link, type LinkProps } from "@tanstack/react-router"
import { ChevronRightIcon } from "lucide-react"
import { useContext, type ReactNode } from "react"
import { SidebarContext } from "./Sidebar.tsx"

export interface Crumb {
  readonly label: ReactNode
  readonly link?: LinkProps
}

/** Where you are, in the page's top bar. While the sidebar is hidden it leaves room for the shell's "Show sidebar" button. */
export function Breadcrumb({ crumbs }: { crumbs: ReadonlyArray<Crumb> }) {
  const hidden = useContext(SidebarContext) === "hidden"
  return (
    <nav aria-label="Breadcrumb" className={`flex h-11 shrink-0 items-center gap-1.5 border-b border-line pr-4 text-[13px] ${hidden ? "pl-11" : "pl-4"}`}>
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
  )
}
