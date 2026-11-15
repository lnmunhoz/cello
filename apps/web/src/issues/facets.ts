// The facet panel's rules (CEL-52), kept pure so they're tested without a page: how labels are laid out
// in groups (Area cut to its busiest 6 until "Show all"), which agent sessions "An agent" opens into,
// what ticking those does, and which filter shows: a link's, or the one kept for the project.
import type { BoardState } from "@cello/client/sync/applyEvents"
import { filterFromSearch, hasFilter, type MatchContext, type TaskFilter } from "@cello/client/sync/filters"
import { type AgentSession, type Label, LABEL_GROUP_NAMES, type LabelGroup, type Task } from "@cello/contract/entities"
import { type Presence, presenceOf } from "@cello/shared/presence"

/** How many areas show before "Show all". */
export const TOP_AREAS = 6

export interface LabelSection {
  readonly group: LabelGroup
  /** Null when no label has a group: one plain list. */
  readonly heading: string | null
  readonly rows: ReadonlyArray<Label>
  /** How many labels the group has, for "Show all 15". */
  readonly size: number
  /** How many of them aren't shown. */
  readonly hidden: number
}

const ORDER: ReadonlyArray<LabelGroup> = ["kind", "area", "milestone", "none"]

/**
 * The Labels section's groups. Kinds go by how many of the project's tasks carry them; areas show the
 * busiest TOP_AREAS, then (with `showAll`) the rest A to Z underneath, and an area you picked always
 * shows. Milestones and the rest go A to Z. Counts come from the whole project, not the filtered view,
 * so rows stay put while you filter.
 */
export const labelSections = (
  labels: ReadonlyArray<Label>,
  tasks: ReadonlyArray<Task>,
  picked: ReadonlyArray<string>,
  showAll: boolean,
): LabelSection[] => {
  const carried = new Map<string, number>()
  for (const task of tasks) for (const id of task.labelIds) carried.set(id, (carried.get(id) ?? 0) + 1)
  const byName = (a: Label, b: Label) => a.name.localeCompare(b.name)
  const busiest = (a: Label, b: Label) => (carried.get(b.id) ?? 0) - (carried.get(a.id) ?? 0) || byName(a, b)
  const grouped = labels.some((l) => l.group !== "none")
  return ORDER.flatMap((group): LabelSection[] => {
    const all = labels.filter((l) => l.group === group)
    if (all.length === 0) return []
    const heading = grouped ? LABEL_GROUP_NAMES[group] : null
    if (group === "kind") return [{ group, heading, rows: [...all].sort(busiest), size: all.length, hidden: 0 }]
    if (group !== "area") return [{ group, heading, rows: [...all].sort(byName), size: all.length, hidden: 0 }]
    const ranked = [...all].sort(busiest)
    const top = ranked.slice(0, TOP_AREAS)
    const rest = ranked.slice(TOP_AREAS).sort(byName)
    const extra = showAll ? rest : rest.filter((l) => picked.includes(l.name.toLowerCase()))
    return [{ group, heading, rows: [...top, ...extra], size: all.length, hidden: rest.length - extra.length }]
  })
}

const PRESENCE_ORDER: Record<Presence, number> = { active: 0, idle: 1, ended: 2 }

/**
 * The agent sessions "An agent" opens into: those holding a claim on the project's tasks, and any the
 * filter picked (so a picked one can be unticked after its claim ends). Working ones first, then the
 * quiet, then the ended; the most recently seen first within each.
 */
export const claimSessions = (board: BoardState, tasks: ReadonlyArray<Task>, picked: ReadonlyArray<string>, now: number): AgentSession[] => {
  const ids = new Set([...tasks.flatMap((t) => (t.assigneeSessionId === null ? [] : [t.assigneeSessionId])), ...picked])
  return [...ids]
    .flatMap((id) => (board.sessions[id] ? [board.sessions[id]] : []))
    .sort((a, b) => PRESENCE_ORDER[presenceOf(a, now)] - PRESENCE_ORDER[presenceOf(b, now)] || b.lastSeenAt - a.lastSeenAt)
}

/** "An agent"'s checkbox: every agent, some of its sessions, or neither. */
export const agentBox = (f: TaskFilter): "on" | "some" | "off" =>
  f.holder.includes("agent") ? "on" : f.sessions.length > 0 ? "some" : "off"

/** Ticking "An agent": every agent's claims (single sessions give way to it), or, ticked again, none. */
export const toggleAgent = (f: TaskFilter): TaskFilter =>
  f.holder.includes("agent")
    ? { ...f, holder: f.holder.filter((h) => h !== "agent"), sessions: [] }
    : { ...f, holder: [...f.holder, "agent"], sessions: [] }

/**
 * Ticking one session under "An agent". While every agent is picked, unticking one keeps the others;
 * ticking the last one of `listed` is the same as "An agent".
 */
export const toggleSession = (f: TaskFilter, id: string, listed: ReadonlyArray<string>): TaskFilter => {
  if (f.holder.includes("agent")) return { ...f, holder: f.holder.filter((h) => h !== "agent"), sessions: listed.filter((s) => s !== id) }
  const sessions = f.sessions.includes(id) ? f.sessions.filter((s) => s !== id) : [...f.sessions, id]
  if (listed.length > 0 && listed.every((s) => sessions.includes(s))) return { ...f, holder: [...f.holder, "agent"], sessions: [] }
  return { ...f, sessions }
}

/** What the strip says where the panel is hidden (narrow windows): "Filtered: 6 of 30 tasks". */
export const filterSummary = (shown: number, total: number): string => `Filtered: ${shown} of ${total} ${total === 1 ? "task" : "tasks"}`

/** Where this device keeps a project's filter: one per project, so the board and the list share it. */
export const filterKey = (projectKey: string): string => `cello:filter:${projectKey.toUpperCase()}`

/** The filter on screen: the URL's when it has one (a link wins), else the one kept for the project. */
export const shownFilter = (search: Record<string, unknown>, kept: TaskFilter): TaskFilter => {
  const linked = filterFromSearch(search)
  return hasFilter(linked) ? linked : kept
}

/** Leaves out labels the workspace doesn't have (renamed, archived) and sessions the board doesn't know. */
export const sanitize = (f: TaskFilter, c: MatchContext): TaskFilter => ({
  ...f,
  labels: f.labels.filter((name) => c.labels.has(name.toLowerCase())),
  sessions: f.sessions.filter((id) => c.board.sessions[id] !== undefined),
})
