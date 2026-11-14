import { useNavigate, useSearch } from "@tanstack/react-router"
import { KanbanIcon, ListIcon, SlidersHorizontalIcon } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/Popover.tsx"
import { SegmentedControl, SegmentedControlItem } from "../components/ui/SegmentedControl.tsx"
import { Select } from "../components/ui/Select.tsx"
import { layoutOf, searchFor, type Layout } from "./layout.ts"

/**
 * The Issues tab's Display popover, after Linear's display options: the List / Board switch, then
 * one row per view option. Grouping by status is the only option for now; sorting, sub-grouping
 * and shown fields join as more rows here.
 */
export function DisplayOptions() {
  const layout = layoutOf(useSearch({ from: "/$projectKey" }))
  const navigate = useNavigate()
  const pick = (next: Layout) => void navigate({ to: ".", search: (prev) => ({ ...prev, ...searchFor(next) }) })

  return (
    <Popover>
      <PopoverTrigger variant="toolbar">
        <SlidersHorizontalIcon aria-hidden className="size-3.5 text-muted" />
        Display
      </PopoverTrigger>
      <PopoverContent aria-label="Display options" align="end">
        <div className="flex w-72 flex-col gap-2 p-1">
          <SegmentedControl aria-label="Layout" value={layout} onValueChange={(value) => value && pick(value as Layout)}>
            <SegmentedControlItem value="list">
              <ListIcon aria-hidden className="size-3.5" />
              List
            </SegmentedControlItem>
            <SegmentedControlItem value="board">
              <KanbanIcon aria-hidden className="size-3.5" />
              Board
            </SegmentedControlItem>
          </SegmentedControl>
          <dl className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-[13px]">
            <dt className="text-muted">Grouping</dt>
            <dd>
              <Select variant="chip" label="Grouping" value="status" options={[{ value: "status", label: "Status" }]} onValueChange={() => {}} />
            </dd>
          </dl>
        </div>
      </PopoverContent>
    </Popover>
  )
}
