import type { ComponentProps, ReactNode } from "react"

/**
 * A pill that says something changed and offers what to do about it: "Cello was updated · Reload"
 * (CEL-37), "The Cello app was updated · Restart" (CEL-75). Its `NoticeStack` places it.
 */
export function NoticeBar(props: Omit<ComponentProps<"div">, "className" | "style">) {
  return (
    <div
      role="status"
      {...props}
      className="pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-raised py-1 pr-1 pl-3 text-[13px] whitespace-nowrap text-ink shadow-pop"
    />
  )
}

/** Where notices show: centred at the top of the window, one under another when there are two. */
export function NoticeStack({ children }: { children: ReactNode }) {
  return <div className="pointer-events-none fixed top-3 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">{children}</div>
}
