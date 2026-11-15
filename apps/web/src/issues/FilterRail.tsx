// The filter panel folded to a rail (CEL-52): a strip of section icons, a badge counting the filters
// on, and a dot on each section that filters. A click on any of them, or ⌘⇧F, opens the panel again.
// Open or folded, and which sections are folded, are kept on this device (./panelState.ts).
import { type FilterField, isActive, type TaskFilter } from "@cello/client/sync/filters"
import { useShortcut, useShortcutHint } from "@ui-sdk/react/shortcuts"
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
import { createTooltipController, Tooltip, TooltipContent, TooltipShortcut, TooltipTrigger } from "../components/ui/Tooltip.tsx"
import { readStored, useStored, writeStored } from "../lib/storage.ts"
import { FOLDED_KEY, foldedKeys, isPanelOpen, PANEL_KEY, PANEL_SHORTCUT, panelValue, toggleFold } from "./panelState.ts"

const setOpen = (open: boolean) => writeStored(PANEL_KEY, panelValue(open))

/** Whether the panel is open (not folded to the rail), on this device. */
export const usePanelOpen = (): boolean => isPanelOpen(useStored(PANEL_KEY))

/** The folded sections, and how to fold or unfold one. */
export const useFolded = (): readonly [ReadonlyArray<string>, (key: string) => void] => [
  foldedKeys(useStored(FOLDED_KEY)),
  (key) => writeStored(FOLDED_KEY, JSON.stringify(toggleFold(foldedKeys(readStored(FOLDED_KEY)), key))),
]

/** ⌘⇧F opens the panel or folds it to the rail. Called once, by the Issues tab. */
export const usePanelShortcut = (): void => {
  const open = usePanelOpen()
  useShortcut(PANEL_SHORTCUT, () => setOpen(!open), { description: "Show or hide the filters" })
}

/** The open panel's button that folds it to the rail, at the right of its header. */
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

interface RailHint {
  readonly label: string
  readonly shortcut?: string | undefined
}

const SECTIONS: ReadonlyArray<{ field: FilterField; name: string; icon: ReactNode }> = [
  { field: "labels", name: "Label", icon: <TagIcon aria-hidden className="size-4" /> },
  { field: "holder", name: "Working on it", icon: <BotIcon aria-hidden className="size-4" /> },
  { field: "priority", name: "Priority", icon: <SignalHighIcon aria-hidden className="size-4" /> },
  { field: "waiting", name: "Waiting on you", icon: <MessageCircleQuestionIcon aria-hidden className="size-4" /> },
  { field: "maker", name: "Created by", icon: <PenLineIcon aria-hidden className="size-4" /> },
  { field: "due", name: "Due date", icon: <CalendarIcon aria-hidden className="size-4" /> },
  { field: "updated", name: "Updated", icon: <ClockIcon aria-hidden className="size-4" /> },
]

const item =
  "relative flex size-7 shrink-0 items-center justify-center rounded-md text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring data-[active]:text-ink"

/** The folded panel: open it, how many filters are on, then one icon per section (a dot when it filters). */
export function FilterRail({ filter, count }: { filter: TaskFilter; count: number }) {
  // The rail's items share one tooltip, as the sidebar's rail does.
  const [tips] = useState(() => createTooltipController<RailHint>())
  const hint = useShortcutHint(PANEL_SHORTCUT)
  const tip = (label: string, child: ReactElement<Record<string, unknown>>, shortcut?: string) => (
    <TooltipTrigger controller={tips} payload={{ label, shortcut } satisfies RailHint} render={child} />
  )
  const counted = count > 0 ? `${count} ${count === 1 ? "filter" : "filters"} on` : "No filters on"
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
        counted,
        <button type="button" aria-label={counted} data-active={count > 0 ? "" : undefined} className={item} onClick={() => setOpen(true)}>
          <ListFilterIcon aria-hidden className="size-4" />
          {count > 0 ? (
            <span
              data-filter-count={count}
              className="absolute -top-1 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold tabular-nums text-accent-ink ring-2 ring-canvas"
            >
              {count}
            </span>
          ) : null}
        </button>,
      )}
      <span aria-hidden className="my-1 h-px w-5 bg-line" />
      {SECTIONS.map((s) => {
        const active = isActive(filter, s.field)
        return (
          <span key={s.field} className="contents">
            {tip(
              s.name,
              <button type="button" aria-label={s.name} data-rail-facet={s.field} data-active={active ? "" : undefined} className={item} onClick={() => setOpen(true)}>
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
