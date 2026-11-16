// The filter panel's own state (CEL-52), kept on this device: whether it's open or folded to the rail,
// which sections are folded, and what's picked in each (the rail's count, a folded heading's words).
import { type FilterField, NO_MILESTONE, type TaskFilter } from "@cello/client/sync/filters"
import { PRIORITY_LABELS } from "../components/ui/PriorityIcon.tsx"

/** Where this device keeps whether the panel is open ("open") or folded to the rail ("rail"). */
export const PANEL_KEY = "cello:filter-panel"
/** Where this device keeps the folded sections: a JSON list of keys (a field, or `group-area`). */
export const FOLDED_KEY = "cello:filter-panel:folded"
/** Opens the panel, or folds it to the rail. */
export const PANEL_SHORTCUT = "mod+shift+f"

/** Open unless this device kept it as the rail. */
export const isPanelOpen = (raw: string | null): boolean => raw !== "rail"
export const panelValue = (open: boolean): string => (open ? "open" : "rail")

/** The folded sections kept on this device; anything unreadable is none. */
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

/** The key a label group folds under. */
export const groupKey = (group: string): string => `group-${group}`

export interface PickedNames {
  /** Lower-case label name → the name as written. */
  readonly labels: ReadonlyMap<string, string>
  /** Lower-case milestone name → the name as written (CEL-113). */
  readonly milestones: ReadonlyMap<string, string>
  /** Session id → "Claude Code · 8a41c9e2". */
  readonly sessions: ReadonlyMap<string, string>
  /** The human's first name. */
  readonly me: string
}

export interface Picked {
  readonly field: FilterField
  readonly name: string
}

/** The Milestone section's row for tasks without one. */
export const NO_MILESTONE_NAME = "No milestone"
const HOLDER = { agent: "An agent", nobody: "Nobody" } as const
const WAITING = { review: "Open review packet", input: "Needs your input" } as const
const DUE = { overdue: "Overdue", week: "Due this week", none: "No due date" } as const
const UPDATED = { day: "In the last 24 hours", week: "In the last 7 days" } as const

/** Each value the filter has on, with its section, in the panel's order: the rail counts them, a folded heading names them. */
export const pickedValues = (f: TaskFilter, names: PickedNames): Picked[] => {
  const text = f.text.trim()
  return [
    ...f.labels.map((l): Picked => ({ field: "labels", name: names.labels.get(l) ?? l })),
    ...f.milestones.map((m): Picked => ({ field: "milestones", name: m === NO_MILESTONE ? NO_MILESTONE_NAME : names.milestones.get(m) ?? m })),
    ...f.holder.map((h): Picked => ({ field: "holder", name: h === "human" ? names.me : HOLDER[h] })),
    ...f.sessions.map((s): Picked => ({ field: "holder", name: names.sessions.get(s) ?? s })),
    ...f.priority.map((p): Picked => ({ field: "priority", name: PRIORITY_LABELS[p] })),
    ...f.waiting.map((w): Picked => ({ field: "waiting", name: WAITING[w] })),
    ...f.maker.map((m): Picked => ({ field: "maker", name: m === "human" ? names.me : "An agent" })),
    ...f.due.map((d): Picked => ({ field: "due", name: DUE[d] })),
    ...(f.updated ? [{ field: "updated" as const, name: UPDATED[f.updated] }] : []),
    ...(text ? [{ field: "text" as const, name: `“${text}”` }] : []),
  ]
}
