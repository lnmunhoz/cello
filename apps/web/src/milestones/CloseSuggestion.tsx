import type { Milestone } from "@cello/contract/entities"
import { useAtomSet } from "@effect/atom-react"
import { CircleCheckIcon } from "lucide-react"
import { Button } from "../components/ui/Button.tsx"
import { commands } from "../lib/cello.ts"

/**
 * "All done: close M3?" (CEL-132), once every task of an open milestone that counts is Done. Closing
 * stays a deliberate act of the human's, so it's a question with a button, never automatic. It sits on
 * a row that opens and drags, so its presses stay its own.
 */
export function CloseSuggestion({ milestone }: { milestone: Milestone }) {
  const close = useAtomSet(commands.closeMilestone)
  return (
    <div
      data-close-suggestion={milestone.name}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
      className="flex items-center gap-2 rounded-md bg-sunken py-1.5 pr-1.5 pl-2.5 text-[13px] dark:bg-hover"
    >
      <CircleCheckIcon aria-hidden className="size-3.5 shrink-0 text-answered" />
      <span className="flex-1 text-ink">All done: close {milestone.name}?</span>
      <Button variant="primary" size="sm" onClick={() => close({ id: milestone.id })}>
        Close {milestone.name}
      </Button>
    </div>
  )
}
