import { updateLine } from "@cello/release/updates"
import { Link } from "@tanstack/react-router"
import { useUpdateState } from "./updates.ts"

/**
 * Cello.app's version at the foot of the sidebar (CEL-140), above the server's build: "Cello 0.5.0 ·
 * Stable · up to date", or "Update available: 0.5.1" in the accent colour. Either opens the Releases page.
 */
export function UpdateFooter() {
  const state = useUpdateState()
  if (!state) return null
  const line = updateLine(state)
  return (
    <Link
      to="/releases"
      data-update-footer={state.status}
      title={state.error && !state.latest ? `Couldn't check for updates: ${state.error}` : undefined}
      className={`block truncate rounded-md px-2 py-1 text-[11px] leading-4 tabular-nums outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring ${
        state.latest ? "font-medium text-accent" : "text-faint hover:text-muted"
      }`}
    >
      {line}
    </Link>
  )
}
