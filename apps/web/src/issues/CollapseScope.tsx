// CEL-52 scope (removed in the real build): the three ways to collapse the filter panel, picked with
// `?collapse=a|b|c|bc`.
//   A · Rail: the panel folds to a thin strip of section icons, with a badge counting the filters on.
//   B · Button + chips: a Filter button beside Display hides the panel; while hidden, the filter shows
//       as removable chips above the board and list.
//   C · Folding sections: each section (and Kind, Area, Milestone) folds on its own, remembered.
//   BC: B and C together.
import { applyFilter, type FilterField, isActive, matchContext, type TaskFilter } from "@cello/client/sync/filters"
import { createTooltipController, Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from "../components/ui/Tooltip.tsx"
import { useShortcut, useShortcutHint } from "@ui-sdk/react/shortcuts"
import { useSearch } from "@tanstack/react-router"
import {
  BotIcon,
  CalendarIcon,
  ClockIcon,
  ListFilterIcon,
  MessageCircleQuestionIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PenLineIcon,
  SignalHighIcon,
  TagIcon,
} from "lucide-react"
import { type ReactElement, type ReactNode, useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Chip } from "../components/ui/Chip.tsx"
import { readStored, useStored, writeStored } from "../lib/storage.ts"
import { sessionWho } from "../presence/model.ts"
import { activeChips, type FilterChip, FOLDED_KEY, foldedKeys, PANEL_OPEN_KEY, PANEL_SHORTCUT, toggleFold } from "./collapseScope.ts"
import type { CollapseMode, IssuesSearch } from "./layout.ts"
import { type FilterState, projectTasks, useFilter, useProjectBoard } from "./useFilter.ts"

export const useCollapseMode = (): CollapseMode | undefined => (useSearch({ from: "/$projectKey" }) as IssuesSearch).collapse
export const usesRail = (m: CollapseMode | undefined) => m === "a"
export const usesButton = (m: CollapseMode | undefined) => m === "b" || m === "bc"
export const usesFolds = (m: CollapseMode | undefined) => m === "c" || m === "bc"

const setOpen = (open: boolean) => writeStored(PANEL_OPEN_KEY, open ? "open" : "closed")

/** Whether the panel is open (A and B), and how to open or close it. */
export const usePanelOpen = (): readonly [boolean, (open: boolean) => void] => [useStored(PANEL_OPEN_KEY) !== "closed", setOpen]

/** The folded sections (C), and how to fold or unfold one. */
export const useFolded = (): readonly [ReadonlyArray<string>, (key: string) => void] => {
  const folded = foldedKeys(useStored(FOLDED_KEY))
  return [folded, (key) => writeStored(FOLDED_KEY, JSON.stringify(toggleFold(foldedKeys(readStored(FOLDED_KEY)), key)))]
}

/** ⌘⇧F opens or closes the panel, in A and B. Called once, by the Issues tab. */
export const usePanelShortcut = (): void => {
  const mode = useCollapseMode()
  const [open] = usePanelOpen()
  useShortcut(usesRail(mode) || usesButton(mode) ? PANEL_SHORTCUT : null, () => setOpen(!open), { description: "Show or hide the filters" })
}

/** The filter's values as chips, with the counts the chips row shows. */
export const useChips = (): { state: FilterState; chips: FilterChip[]; shown: number; total: number } | null => {
  const state = useFilter()
  const loaded = useProjectBoard()
  if (!loaded) return null
  const { board, workspaceId, project } = loaded
  const labels = new Map(
    Object.values(board.labels)
      .filter((l) => l.workspaceId === workspaceId && l.archivedAt === null)
      .map((l) => [l.name.toLowerCase(), { name: l.name, color: l.color }]),
  )
  const sessions = new Map(Object.values(board.sessions).map((s) => [s.id, `${s.clientName} · ${sessionWho(s).short}`]))
  const me = Object.values(board.actors).find((a) => a.kind === "human")?.name.split(" ")[0] ?? "Lucas"
  const tasks = projectTasks(board, workspaceId, project.id).filter((t) => t.number > 0)
  const shown = state.active ? applyFilter(tasks, state.filter, matchContext(board, workspaceId, Date.now())).length : tasks.length
  return { state, chips: activeChips(state.filter, { labels, sessions, me }), shown, total: tasks.length }
}

/** The badge with how many filters are on. */
function CountBadge({ count, ring = false }: { count: number; ring?: boolean }) {
  return (
    <span
      data-filter-count={count}
      className={`flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold tabular-nums text-accent-ink ${ring ? "absolute -top-1 -right-1.5 ring-2 ring-canvas" : ""}`}
    >
      {count}
    </span>
  )
}

/** The panel's own hide button, at the right of its header (A and B). */
export function HidePanelButton() {
  const hint = useShortcutHint(PANEL_SHORTCUT)
  return (
    <Tooltip shortcut={PANEL_SHORTCUT}>
      <TooltipTrigger render={<Button variant="ghost" size="icon" aria-label="Hide filters" aria-keyshortcuts={hint.ariaKeyshortcuts} onClick={() => setOpen(false)} />}>
        <PanelLeftCloseIcon aria-hidden className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        Hide filters
        <TooltipShortcut />
      </TooltipContent>
    </Tooltip>
  )
}

// ---------- A · Rail ----------

interface RailHint {
  readonly label: string
  readonly shortcut?: string | undefined
}

const RAIL_SECTIONS: ReadonlyArray<{ field: FilterField; name: string; icon: ReactNode }> = [
  { field: "labels", name: "Label", icon: <TagIcon aria-hidden className="size-4" /> },
  { field: "holder", name: "Working on it", icon: <BotIcon aria-hidden className="size-4" /> },
  { field: "priority", name: "Priority", icon: <SignalHighIcon aria-hidden className="size-4" /> },
  { field: "waiting", name: "Waiting on you", icon: <MessageCircleQuestionIcon aria-hidden className="size-4" /> },
  { field: "maker", name: "Created by", icon: <PenLineIcon aria-hidden className="size-4" /> },
  { field: "due", name: "Due date", icon: <CalendarIcon aria-hidden className="size-4" /> },
  { field: "updated", name: "Updated", icon: <ClockIcon aria-hidden className="size-4" /> },
]

const railItem =
  "relative flex size-7 shrink-0 items-center justify-center rounded-md text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring data-[active]:text-ink"

/** The folded panel: open it, how many filters are on, then one icon per section (a dot when it filters). */
export function FilterRail({ filter, count }: { filter: TaskFilter; count: number }) {
  const [tips] = useState(() => createTooltipController<RailHint>())
  const hint = useShortcutHint(PANEL_SHORTCUT)
  const tip = (label: string, child: ReactElement<Record<string, unknown>>, shortcut?: string) => (
    <TooltipTrigger controller={tips} payload={{ label, shortcut } satisfies RailHint} render={child} />
  )
  return (
    <aside
      aria-label="Filters"
      data-facets="rail"
      onClickCapture={() => tips.close()}
      className="hidden w-11 shrink-0 flex-col items-center gap-1 border-r border-line pt-1 pb-4 md:flex"
    >
      <Tooltip controller={tips}>
        <TooltipContent>
          {(state) => {
            const h = state.payload as RailHint | undefined
            return (
              <>
                {h?.label}
                {h?.shortcut ? <TooltipShortcut shortcut={h.shortcut} /> : null}
              </>
            )
          }}
        </TooltipContent>
      </Tooltip>
      {tip(
        "Show filters",
        <Button variant="ghost" size="iconMd" aria-label="Show filters" aria-keyshortcuts={hint.ariaKeyshortcuts} onClick={() => setOpen(true)}>
          <PanelLeftOpenIcon aria-hidden className="size-4" />
        </Button>,
        PANEL_SHORTCUT,
      )}
      {tip(
        count > 0 ? `${count} ${count === 1 ? "filter" : "filters"} on` : "No filters on",
        <button type="button" aria-label={count > 0 ? `${count} ${count === 1 ? "filter" : "filters"} on` : "No filters on"} className={railItem} data-active={count > 0 ? "" : undefined} onClick={() => setOpen(true)}>
          <ListFilterIcon aria-hidden className="size-4" />
          {count > 0 ? <CountBadge count={count} ring /> : null}
        </button>,
      )}
      <span aria-hidden className="my-1 h-px w-5 bg-line" />
      {RAIL_SECTIONS.map((s) => {
        const active = isActive(filter, s.field)
        return (
          <span key={s.field} className="contents">
            {tip(
              s.name,
              <button type="button" aria-label={s.name} data-rail-facet={s.field} data-active={active ? "" : undefined} className={railItem} onClick={() => setOpen(true)}>
                {s.icon}
                {active ? <i aria-hidden className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-accent ring-2 ring-canvas" /> : null}
              </button>,
            )}
          </span>
        )
      })}
    </aside>
  )
}

// ---------- B · Button + chips ----------

/** The Filter button beside Display: shows or hides the panel, with how many filters are on. */
export function FilterButton() {
  const mode = useCollapseMode()
  const [open] = usePanelOpen()
  const chips = useChips()
  const hint = useShortcutHint(PANEL_SHORTCUT)
  if (!usesButton(mode)) return null
  const count = chips?.chips.length ?? 0
  return (
    <Tooltip shortcut={PANEL_SHORTCUT}>
      <TooltipTrigger
        render={<Button variant="toolbar" size="toolbar" aria-pressed={open} aria-keyshortcuts={hint.ariaKeyshortcuts} data-filter-button onClick={() => setOpen(!open)} />}
      >
        <ListFilterIcon aria-hidden className="size-3.5 text-muted" />
        Filter
        {count > 0 ? <CountBadge count={count} /> : null}
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {open ? "Hide filters" : "Show filters"}
        <TooltipShortcut />
      </TooltipContent>
    </Tooltip>
  )
}

/** While B's panel is hidden: the filters on, as chips above the board and list, each with an ×. */
export function FilterChips() {
  const mode = useCollapseMode()
  const [open] = usePanelOpen()
  const data = useChips()
  if (!usesButton(mode) || open || !data || data.chips.length === 0) return null
  const { state, chips, shown, total } = data
  return (
    <div data-filter-chips className="hidden shrink-0 flex-wrap items-center gap-1.5 px-3 pb-2 md:flex">
      {chips.map((c) => (
        <Chip key={c.key} tone="filter" prefix={c.field} {...(c.color ? { color: c.color } : {})} onRemove={() => state.set(c.remove(state.filter))} removeLabel={`Remove ${c.name}`}>
          {c.name}
        </Chip>
      ))}
      <span className="ml-1 text-xs text-muted tabular-nums">
        {shown} of {total} tasks
      </span>
      <Button variant="ghost" size="sm" onClick={state.clear}>
        Clear all
      </Button>
    </div>
  )
}
