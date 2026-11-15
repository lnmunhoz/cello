import { ORDERING_LABELS, ORDERINGS, parseOrdering } from "@cello/client/sync/ordering"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { KanbanIcon, ListIcon, SlidersHorizontalIcon } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/Popover.tsx"
import { SegmentedControl, SegmentedControlItem } from "../components/ui/SegmentedControl.tsx"
import { Select } from "../components/ui/Select.tsx"
import { Switch } from "../components/ui/Switch.tsx"
import { showAgentCursors, useAgentCursorsShown } from "../board/cursors/settings.ts"
import { showNeedsInputColumn, useNeedsInputColumn } from "../board/needsInputColumn.ts"
import { showStageLanes, useStageLanes } from "../board/useStageLanes.ts"
import { layoutOf, searchFor, type Layout } from "./layout.ts"
import { useOrdering } from "./useOrdering.ts"

const orderingOptions = ORDERINGS.map((value) => ({ value, label: ORDERING_LABELS[value] }))

/**
 * The Issues tab's Display popover, after Linear's display options: the List / Board switch, then
 * one row per view option: grouping (by status, the only one for now) and the order of cards in
 * each column or group. The button names the ordering when it isn't the manual drag order.
 */
export function DisplayOptions() {
  const layout = layoutOf(useSearch({ from: "/$projectKey" }))
  const navigate = useNavigate()
  const pickLayout = (next: Layout) => void navigate({ to: ".", search: (prev) => ({ ...prev, ...searchFor(next) }) })
  const { ordering, pick } = useOrdering()

  return (
    <Popover>
      <PopoverTrigger variant="toolbar">
        <SlidersHorizontalIcon aria-hidden className="size-3.5 text-muted" />
        Display
        {ordering === "manual" ? null : <span className="text-muted">· {ORDERING_LABELS[ordering]}</span>}
      </PopoverTrigger>
      <PopoverContent aria-label="Display options" align="end">
        <div className="flex w-72 flex-col gap-2 p-1">
          <SegmentedControl aria-label="Layout" value={layout} onValueChange={(value) => value && pickLayout(value as Layout)}>
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
            <dt className="text-muted">Ordering</dt>
            <dd>
              <Select
                variant="chip"
                label="Ordering"
                value={ordering}
                options={orderingOptions}
                onValueChange={(value) => {
                  const next = parseOrdering(value)
                  if (next) pick(next)
                }}
              />
            </dd>
          </dl>
          <NeedsInputColumnRow />
          <StageLanesRow />
          <AgentCursorsRow />
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Needs input as its own column and list group (CEL-47): off unless turned on on this device. */
function NeedsInputColumnRow() {
  const on = useNeedsInputColumn()
  return (
    <label className="flex items-center justify-between gap-3 border-t border-line pt-2 text-[13px]">
      <span className="text-muted">Needs input column</span>
      <Switch checked={on} onCheckedChange={(next) => showNeedsInputColumn(next)} />
    </label>
  )
}

/** In Progress split into a lane per stage (CEL-35): off unless turned on on this device. */
function StageLanesRow() {
  const on = useStageLanes()
  return (
    <label className="flex items-center justify-between gap-3 border-t border-line pt-2 text-[13px]">
      <span className="text-muted">Group In Progress by stage</span>
      <Switch checked={on} onCheckedChange={(next) => showStageLanes(next)} />
    </label>
  )
}

/** Agents' cursors flying over the board (CEL-6): on unless turned off on this device. */
function AgentCursorsRow() {
  const shown = useAgentCursorsShown()
  return (
    <label className="flex items-center justify-between gap-3 border-t border-line pt-2 text-[13px]">
      <span className="text-muted">Show agent cursors</span>
      <Switch checked={shown} onCheckedChange={(on) => showAgentCursors(on)} />
    </label>
  )
}
