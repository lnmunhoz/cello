import type { ParsedDiff } from "@cello/shared/diff"
import { CopyIcon } from "lucide-react"
import { useState, type ReactNode } from "react"
import { Button } from "../components/ui/Button.tsx"
import { SegmentedControl, SegmentedControlItem } from "../components/ui/SegmentedControl.tsx"
import { copyText } from "../lib/clipboard.ts"
import { useElementWidth } from "../lib/useElementWidth.ts"
import { DiffSummary, DiffView } from "./DiffView.tsx"
import { canSplit, inlineControls, shownMode, type DiffMode } from "./rules.ts"

/**
 * A diff with its "Show as" choice: Unified, Split or Raw. Split is offered only while this view is wide
 * enough for two columns (rules.ts); a chosen Split shows Unified until it is wide again. `raw` is the
 * text's own view, shown for Raw under the same summary row.
 *
 * - `panel` (default): a text file that is a diff (CEL-173). It fills the side panel and scrolls.
 * - `inline`: a ```diff block in a comment or page (CEL-176). It is a framed block that grows with its
 *   content, with a Copy button for `source` (the block's text), and offers "Show as" only when the room
 *   allows (rules.ts: inlineControls); in the narrowest panel only Copy shows.
 */
export type DiffTextProps = { diff: ParsedDiff; label: string; raw: ReactNode } & ({ variant?: "panel" } | { variant: "inline"; source: string })

export function DiffText(props: DiffTextProps) {
  const { diff, label, raw } = props
  const [chosen, setChosen] = useState<DiffMode>("unified")
  const [measure, width] = useElementWidth()
  const inline = props.variant === "inline"
  const controls = inline ? inlineControls(width) : { showAs: true, split: canSplit(width) }
  // With no control to change it back, a chosen Raw would be stuck: a view too narrow for the control draws Unified.
  const mode = controls.showAs ? shownMode(chosen, width) : "unified"
  return (
    <div ref={measure} {...(inline ? { "data-diff-block": "" } : {})} className={inline ? "overflow-hidden rounded-md border border-line" : "flex min-h-0 flex-1 flex-col"}>
      <DiffSummary diff={diff}>
        {controls.showAs ? (
          <SegmentedControl size="sm" aria-label="Show as" value={mode} onValueChange={(value) => value && setChosen(value as DiffMode)}>
            <SegmentedControlItem value="unified">Unified</SegmentedControlItem>
            {controls.split ? <SegmentedControlItem value="split">Split</SegmentedControlItem> : null}
            <SegmentedControlItem value="raw">Raw</SegmentedControlItem>
          </SegmentedControl>
        ) : null}
        {props.variant === "inline" ? (
          <Button variant="ghost" size="icon" aria-label="Copy" title="Copy the diff" onClick={() => copyText(props.source, "Copied")}>
            <CopyIcon aria-hidden className="size-3.5" />
          </Button>
        ) : null}
      </DiffSummary>
      {mode === "raw" ? raw : <DiffView diff={diff} mode={mode} label={label} variant={inline ? "inline" : "panel"} />}
    </div>
  )
}
