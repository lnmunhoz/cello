// CEL-52 scope (removed in the real build): the pure parts of the three ways to collapse the filter
// panel, picked with `?collapse=a|b|c|bc`. A folds it to a rail with a count; B hides it behind a
// Filter button and shows the filter as chips above the board; C folds each section on its own.
import type { FilterField, TaskFilter } from "@cello/client/sync/filters"
import { PRIORITY_LABELS } from "../components/ui/PriorityIcon.tsx"

/** Whether the panel is open, on this device ("closed" when folded or hidden). */
export const PANEL_OPEN_KEY = "cello:facets:open"
/** Which sections (and label groups) are folded, on this device: a JSON list of keys. */
export const FOLDED_KEY = "cello:facets:folded"
/** Opens or closes the panel, for A and B. */
export const PANEL_SHORTCUT = "mod+shift+f"

export const foldedKeys = (raw: string | null): string[] => {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string") : []
  } catch {
    return []
  }
}

export const toggleFold = (folded: ReadonlyArray<string>, key: string): string[] =>
  folded.includes(key) ? folded.filter((k) => k !== key) : [...folded, key]

export interface ChipNames {
  /** Lower-case label name → its name as written and colour. */
  readonly labels: ReadonlyMap<string, { readonly name: string; readonly color: string }>
  /** Session id → "Claude Code · 8a41c9e2". */
  readonly sessions: ReadonlyMap<string, string>
  readonly me: string
}

export interface FilterChip {
  readonly key: string
  /** The panel section it belongs to. */
  readonly facet: FilterField
  /** The property, shown before the value; null for labels, which name themselves. */
  readonly field: string | null
  readonly name: string
  readonly color?: string
  readonly remove: (f: TaskFilter) => TaskFilter
}

const without = <T,>(list: ReadonlyArray<T>, value: T): T[] => list.filter((v) => v !== value)

const HOLDER = { agent: "An agent", nobody: "Nobody" } as const
const WAITING = { review: "Open review packet", input: "Needs your input" } as const
const DUE = { overdue: "Overdue", week: "Due this week", none: "No due date" } as const
const UPDATED = { day: "In the last 24 hours", week: "In the last 7 days" } as const

/** One chip per value the filter has on: labels first, then the other properties in the panel's order. */
export const activeChips = (f: TaskFilter, names: ChipNames): FilterChip[] => [
  ...f.labels.map((l): FilterChip => {
    const label = names.labels.get(l)
    return { key: `label-${l}`, facet: "labels", field: null, name: label?.name ?? l, ...(label ? { color: label.color } : {}), remove: (x) => ({ ...x, labels: without(x.labels, l) }) }
  }),
  ...f.holder.map((h): FilterChip => ({
    key: `who-${h}`,
    facet: "holder",
    field: "Working on it",
    name: h === "human" ? names.me : HOLDER[h],
    remove: (x) => ({ ...x, holder: without(x.holder, h), ...(h === "agent" ? { sessions: [] } : {}) }),
  })),
  ...f.sessions.map((s): FilterChip => ({ key: `session-${s}`, facet: "holder", field: "Working on it", name: names.sessions.get(s) ?? s, remove: (x) => ({ ...x, sessions: without(x.sessions, s) }) })),
  ...f.priority.map((p): FilterChip => ({ key: `priority-${p}`, facet: "priority", field: "Priority", name: PRIORITY_LABELS[p], remove: (x) => ({ ...x, priority: without(x.priority, p) }) })),
  ...f.waiting.map((w): FilterChip => ({ key: `waiting-${w}`, facet: "waiting", field: "Waiting", name: WAITING[w], remove: (x) => ({ ...x, waiting: without(x.waiting, w) }) })),
  ...f.maker.map((m): FilterChip => ({ key: `by-${m}`, facet: "maker", field: "Created by", name: m === "human" ? names.me : "An agent", remove: (x) => ({ ...x, maker: without(x.maker, m) }) })),
  ...f.due.map((d): FilterChip => ({ key: `due-${d}`, facet: "due", field: "Due", name: DUE[d], remove: (x) => ({ ...x, due: without(x.due, d) }) })),
  ...(f.updated ? [{ key: "updated", facet: "updated" as const, field: "Updated", name: UPDATED[f.updated], remove: (x: TaskFilter): TaskFilter => ({ ...x, updated: null }) }] : []),
  ...(f.text.trim() ? [{ key: "text", facet: "text" as const, field: "Text", name: `“${f.text.trim()}”`, remove: (x: TaskFilter): TaskFilter => ({ ...x, text: "" }) }] : []),
]
