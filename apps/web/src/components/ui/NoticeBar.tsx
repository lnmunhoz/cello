import type { ComponentProps, ReactNode } from "react"

/**
 * A pill that says something changed and offers what to do about it: "Cello was updated · Reload"
 * (CEL-37), "The Cello app was updated · Restart" (CEL-75). Its `NoticeStack` places it.
 *
 * `details` opens more under the line (what's in a new build, CEL-148): the pill becomes a card, the
 * line stays where it was, and the same elements stay mounted, so a toggle in the line keeps its focus.
 */
export function NoticeBar({ children, details, ...props }: Omit<ComponentProps<"div">, "className" | "style"> & { details?: ReactNode }) {
  const open = details !== undefined && details !== null && details !== false
  return (
    <div
      {...props}
      className={`pointer-events-auto flex flex-col border border-line bg-raised text-[13px] text-ink shadow-pop ${
        open ? "w-[28rem] max-w-[calc(100vw-2rem)] rounded-xl" : "rounded-full"
      }`}
    >
      <div role="status" className="flex items-center gap-2 py-1 pr-1 pl-3 whitespace-nowrap">
        {children}
      </div>
      {open ? <div className="border-t border-line">{details}</div> : null}
    </div>
  )
}

/** Where notices show: centred at the top of the window, one under another when there are two. */
export function NoticeStack({ children }: { children: ReactNode }) {
  return <div className="pointer-events-none fixed top-3 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">{children}</div>
}
