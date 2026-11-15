import { CloudOffIcon } from "lucide-react"
import { useConnection } from "../lib/hooks.ts"

/** What to say while the board isn't live, or null while it is. */
export const useConnectionText = (): string | null => {
  const connection = useConnection()
  return connection === "live" ? null : connection === "connecting" ? "Connecting…" : "Reconnecting to the Cello server…"
}

/**
 * "Reconnecting to the Cello server…" while the board isn't live: a line in the expanded sidebar, or a
 * pill in the main panel while the sidebar is hidden. (The rail shows it as an icon with its tooltip.)
 */
export function ConnectionStatus({ look }: { look: "row" | "pill" }) {
  const text = useConnectionText()
  if (text === null) return null
  return look === "row" ? (
    <p role="status" className="px-2 text-xs text-faint">
      {text}
    </p>
  ) : (
    <p
      role="status"
      className="absolute bottom-3 left-3 z-30 flex items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 py-1 text-xs font-medium text-muted shadow-pop"
    >
      <CloudOffIcon aria-hidden className="size-3.5" />
      {text}
    </p>
  )
}
