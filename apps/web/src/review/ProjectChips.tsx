import type { Project } from "@cello/contract/entities"
import { Button } from "../components/ui/Button.tsx"
import { SegmentedControl, SegmentedControlItem } from "../components/ui/SegmentedControl.tsx"
import { ALL, type ProjectChips as Chips } from "./queueView.ts"

/**
 * "All 3 · Alpha 2 · Beta 1": the projects the Agents and Review pages can be narrowed to (CEL-188), each
 * with its row count, the counts of the whole list so rows stay put while you filter. Hidden while it
 * would offer nothing: fewer than two projects have rows and none is picked. A long row scrolls sideways.
 */
export function ProjectChips({ chips, picked, onPick }: { chips: Chips; picked: Project | null; onPick: (next: Project | null) => void }) {
  if (chips.chips.length < 2 && picked === null) return null
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1" data-project-chips="">
      <SegmentedControl
        aria-label="Project"
        fit="content"
        value={picked?.key ?? ALL}
        onValueChange={(value) => {
          if (!value) return
          onPick(chips.chips.find((c) => c.project.key === value)?.project ?? null)
        }}
      >
        <SegmentedControlItem value={ALL}>
          All <Count n={chips.all} />
        </SegmentedControlItem>
        {chips.chips.map(({ project, count }) => (
          <SegmentedControlItem key={project.id} value={project.key}>
            <i aria-hidden className="size-2 shrink-0 rounded-[3px]" style={{ background: project.color }} />
            {project.name} <Count n={count} />
          </SegmentedControlItem>
        ))}
      </SegmentedControl>
    </div>
  )
}

/** What a page shows when its project has no rows: say so, and a way back to All. */
export function NothingFor({ project, onShowAll }: { project: Project; onShowAll: () => void }) {
  return (
    <div data-nothing-for={project.key} className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-6 py-14 text-center text-[13px] text-muted">
      <p className="text-[15px] font-medium text-ink">Nothing for {project.name} right now</p>
      <Button onClick={onShowAll}>Show all</Button>
    </div>
  )
}

const Count =({ n }: { n: number }) => <span className="font-normal tabular-nums text-faint">{n}</span>
