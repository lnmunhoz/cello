import type { ParsedDiff } from "@cello/shared/diff"
import { useState, type ReactNode } from "react"
import { SegmentedControl, SegmentedControlItem } from "../components/ui/SegmentedControl.tsx"
import { useElementWidth } from "../lib/useElementWidth.ts"
import { DiffSummary, DiffView } from "./DiffView.tsx"
import { canSplit, shownMode, type DiffMode } from "./rules.ts"

/**
 * A text file that is a diff (CEL-173), with its "Show as" choice: Unified, Split or Raw. Split is
 * offered only while this view is wide enough for two columns (rules.ts); a chosen Split shows Unified
 * until it is wide again. `raw` is the file's own text view, shown for Raw under the same summary row.
 */
export function DiffText({ diff, label, raw }: { diff: ParsedDiff; label: string; raw: ReactNode }) {
  const [chosen, setChosen] = useState<DiffMode>("unified")
  const [measure, width] = useElementWidth()
  const mode = shownMode(chosen, width)
  return (
    <div ref={measure} className="flex min-h-0 flex-1 flex-col">
      <DiffSummary diff={diff}>
        <SegmentedControl size="sm" aria-label="Show as" value={mode} onValueChange={(value) => value && setChosen(value as DiffMode)}>
          <SegmentedControlItem value="unified">Unified</SegmentedControlItem>
          {canSplit(width) ? <SegmentedControlItem value="split">Split</SegmentedControlItem> : null}
          <SegmentedControlItem value="raw">Raw</SegmentedControlItem>
        </SegmentedControl>
      </DiffSummary>
      {mode === "raw" ? raw : <DiffView diff={diff} mode={mode} label={label} />}
    </div>
  )
}
