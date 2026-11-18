import { ORDERING_LABELS, ORDERINGS, parseOrdering } from "@cello/client/sync/ordering"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { KanbanIcon, ListIcon, SlidersHorizontalIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/Popover.tsx"
import { SegmentedControl, SegmentedControlItem } from "../components/ui/SegmentedControl.tsx"
import { Select } from "../components/ui/Select.tsx"
import { Switch } from "../components/ui/Switch.tsx"
import { showAgentCursors, useAgentCursorsShown } from "../board/cursors/settings.ts"
import { showCardMilestone, useCardMilestone } from "../board/cardMilestone.ts"
import { showNeedsInputColumn, useNeedsInputColumn } from "../board/needsInputColumn.ts"
import { showStageLanes, useStageLanes } from "../board/useStageLanes.ts"
import { groupingOf, groupSearch, layoutOf, searchFor, type Layout } from "./layout.ts"
import { useOrdering } from "./useOrdering.ts"

const orderingOptions = ORDERINGS.map((value) => ({ value, label: ORDERING_LABELS[value] }))
const groupingOptions = [{ value: "status", label: "Status" }, { value: "milestone", label: "Milestone" }]

/**
 * The Issues tab's Display popover, after Linear's display options: the List / Board switch, then
 * one row per view option: grouping (by status, or on the board by milestone too: CEL-132) and the order of cards in
 * each column or group. The button names the ordering when it isn't the manual drag order.
 */
export function DisplayOptions() {
  const search = useSearch({ from: "/$projectKey" })
  const layout = layoutOf(search)
  const grouping = groupingOf(search)
  const navigate = useNavigate()
  const pickLayout = (next: Layout) => void navigate({ to: ".", search: (prev) => ({ ...prev, ...searchFor(next) }) })
  const { ordering, pick } = useOrdering()

  return (
    <DisplayMenu note={ordering === "manual" ? null : ORDERING_LABELS[ordering]}>
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
      <DisplayFields>
        <DisplayField label="Grouping">
          {/* Milestone (CEL-132): swimlanes on the board; the list keeps its status groups. */}
          <Select
            variant="chip"
            label="Grouping"
            value={grouping}
            options={layout === "board" ? groupingOptions : groupingOptions.slice(0, 1)}
            onValueChange={(value) => {
              if (value === "status" || value === "milestone") void navigate({ to: ".", search: (prev) => ({ ...prev, ...groupSearch(value) }) })
            }}
          />
        </DisplayField>
        <DisplayField label="Ordering">
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
        </DisplayField>
      </DisplayFields>
      <NeedsInputColumnRow />
      <StageLanesRow />
      <CardMilestoneRow />
      <AgentCursorsRow />
    </DisplayMenu>
  )
}

/**
 * The Display button and its popover (the Issues tab's, and the Agents and Review pages': CEL-188): the
 * button reads "Display" and, when `note` is set, "· note" (the order in use, when it isn't the default).
 */
export function DisplayMenu({ note, children }: { note: string | null; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger variant="toolbar">
        <SlidersHorizontalIcon aria-hidden className="size-3.5 text-muted" />
        Display
        {note === null ? null : <span className="text-muted">· {note}</span>}
      </PopoverTrigger>
      <PopoverContent aria-label="Display options" align="end">
        <div className="flex w-72 flex-col gap-2 p-1">{children}</div>
      </PopoverContent>
    </Popover>
  )
}

/** The popover's label and value rows, as a grid. */
export function DisplayFields({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-t border-line pt-2 text-[13px]">{children}</dl>
}

/** One row of DisplayFields: its label, and the control that sets it. */
export function DisplayField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd>{children}</dd>
    </>
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

/** A card's milestone chip (CEL-113): on unless turned off on this device. */
function CardMilestoneRow() {
  const on = useCardMilestone()
  return (
    <label className="flex items-center justify-between gap-3 border-t border-line pt-2 text-[13px]">
      <span className="text-muted">Show milestone on cards</span>
      <Switch checked={on} onCheckedChange={(next) => showCardMilestone(next)} />
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
