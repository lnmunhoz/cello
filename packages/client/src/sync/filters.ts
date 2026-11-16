// Filtering a project's tasks on the Issues tab (CEL-52): which tasks a filter shows, how many each
// value would show (faceted counts), and the filter as URL search params and as this device's saved
// copy. Pure, so the board, the list and the facet panel agree, and the CLI can share it later.
//
// Labels match by group: any picked label within a group, and every group picked. `bug` + `agents`
// shows the bugs in agents; `bug` + `feature` shows both kinds.
import type { Label, LabelGroup, Priority, Scope, Task } from "@cello/contract/entities"
import type { BoardState } from "./applyEvents.ts"
import { openAskOf } from "./asks.ts"
import { openReviewOf } from "./reviews.ts"

/** Who holds the task's claim: an agent session, the human, or nobody. */
export type Holder = "agent" | "human" | "nobody"
export type Maker = "agent" | "human"
/** Waiting on Lucas: an open review packet, or an agent's questions (Needs input). */
export type Waiting = "review" | "input"
export type Due = "overdue" | "week" | "none"
export type Updated = "day" | "week"

export interface TaskFilter {
  /** Label names, lower case (what the URL carries). */
  readonly labels: ReadonlyArray<string>
  readonly priority: ReadonlyArray<Priority>
  readonly holder: ReadonlyArray<Holder>
  /** Agent sessions by id: their claims match too, beside `holder` ("An agent" opens into these). */
  readonly sessions: ReadonlyArray<string>
  readonly maker: ReadonlyArray<Maker>
  readonly waiting: ReadonlyArray<Waiting>
  readonly due: ReadonlyArray<Due>
  readonly updated: Updated | null
  readonly text: string
}

export const EMPTY_FILTER: TaskFilter = {
  labels: [],
  priority: [],
  holder: [],
  sessions: [],
  maker: [],
  waiting: [],
  due: [],
  updated: null,
  text: "",
}

export type FilterField = "labels" | "priority" | "holder" | "maker" | "waiting" | "due" | "updated" | "text"

export const FIELDS: ReadonlyArray<FilterField> = ["labels", "priority", "holder", "maker", "waiting", "due", "updated", "text"]

export const isActive = (f: TaskFilter, field: FilterField): boolean => {
  switch (field) {
    case "holder":
      return f.holder.length > 0 || f.sessions.length > 0
    case "updated":
      return f.updated !== null
    case "text":
      return f.text.trim() !== ""
    default:
      return f[field].length > 0
  }
}

export const activeFields = (f: TaskFilter): FilterField[] => FIELDS.filter((field) => isActive(f, field))

/** Whether the filter narrows anything. */
export const hasFilter = (f: TaskFilter): boolean => activeFields(f).length > 0

export const clearField = (f: TaskFilter, field: FilterField): TaskFilter =>
  field === "holder" ? { ...f, holder: [], sessions: [] } : { ...f, [field]: EMPTY_FILTER[field] }

/** What a match needs besides the task: the board (actors, reviews, asks), the labels in view by name, and today. */
export interface MatchContext {
  readonly board: BoardState
  /**
   * The live labels in view: lower-case name → the labels of that name, with their groups. A project's
   * view has its own labels, one per name (CEL-80); All projects has every project's, so "bug" is each
   * project's bug.
   */
  readonly labels: ReadonlyMap<string, ReadonlyArray<{ readonly id: string; readonly group: LabelGroup }>>
  readonly now: number
}

/** The live labels a project's view offers (`{ projectId }`), or All projects' (`{ workspaceId }`). */
export const labelsInScope = (board: BoardState, scope: Scope): Label[] =>
  Object.values(board.labels).filter((l) =>
    l.archivedAt === null &&
    ("projectId" in scope ? l.projectId === scope.projectId : board.projects[l.projectId]?.workspaceId === scope.workspaceId)
  )

export const matchContext = (board: BoardState, scope: Scope, now: number): MatchContext => {
  const labels = new Map<string, Array<{ readonly id: string; readonly group: LabelGroup }>>()
  for (const l of labelsInScope(board, scope)) {
    const name = l.name.toLowerCase()
    labels.set(name, [...(labels.get(name) ?? []), { id: l.id, group: l.group }])
  }
  return { board, labels, now }
}

const DAY = 86_400_000

const isoDay = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

export const holderOf = (task: Task, board: BoardState): Holder => {
  if (task.assigneeActorId === null) return "nobody"
  if (task.assigneeSessionId !== null) return "agent"
  return board.actors[task.assigneeActorId]?.kind === "agent" ? "agent" : "human"
}

export const makerOf = (task: Task, board: BoardState): Maker =>
  task.createdBySessionId !== null || board.actors[task.createdByActorId]?.kind === "agent" ? "agent" : "human"

/** Overdue, due within a week, no due date, or null (due later). */
export const dueOf = (task: Task, now: number): Due | null => {
  if (task.dueDate === null) return "none"
  if (task.dueDate < isoDay(now)) return "overdue"
  if (task.dueDate <= isoDay(now + 7 * DAY)) return "week"
  return null
}

/** The picked labels in view, by group: label ids per group. */
const pickedGroups = (f: TaskFilter, c: MatchContext): Map<LabelGroup, string[]> => {
  const groups = new Map<LabelGroup, string[]>()
  for (const name of f.labels) {
    for (const label of c.labels.get(name.toLowerCase()) ?? []) groups.set(label.group, [...(groups.get(label.group) ?? []), label.id])
  }
  return groups
}

const labelsMatch = (task: Task, f: TaskFilter, c: MatchContext, exceptGroup?: LabelGroup): boolean => {
  for (const [group, ids] of pickedGroups(f, c)) {
    if (group !== exceptGroup && !ids.some((id) => task.labelIds.includes(id))) return false
  }
  return true
}

const check: Record<Exclude<FilterField, "labels">, (task: Task, f: TaskFilter, c: MatchContext) => boolean> = {
  priority: (task, f) => f.priority.includes(task.priority),
  holder: (task, f, c) =>
    f.holder.includes(holderOf(task, c.board)) || (task.assigneeSessionId !== null && f.sessions.includes(task.assigneeSessionId)),
  maker: (task, f, c) => f.maker.includes(makerOf(task, c.board)),
  waiting: (task, f, c) =>
    (f.waiting.includes("review") && openReviewOf(c.board, task.id) !== undefined) ||
    (f.waiting.includes("input") && openAskOf(c.board, task.id) !== undefined),
  due: (task, f, c) => {
    const due = dueOf(task, c.now)
    return due !== null && f.due.includes(due)
  },
  updated: (task, f, c) => c.now - task.updatedAt <= (f.updated === "day" ? DAY : 7 * DAY),
  text: (task, f) => {
    const q = f.text.trim().toLowerCase()
    return task.key.toLowerCase().includes(q) || task.title.toLowerCase().includes(q) || task.description.toLowerCase().includes(q)
  },
}

/** Leave one facet out of a match: a field, or one label group (for that group's counts). */
type Except = FilterField | { readonly group: LabelGroup }

const passes = (task: Task, f: TaskFilter, c: MatchContext, except?: Except): boolean =>
  FIELDS.every((field) => {
    if (field === except || !isActive(f, field)) return true
    if (field === "labels") return labelsMatch(task, f, c, typeof except === "object" ? except.group : undefined)
    return check[field](task, f, c)
  })

/** Whether the task passes every active filter. */
export const matches = (task: Task, f: TaskFilter, c: MatchContext): boolean => passes(task, f, c)

/** Keeps the tasks the filter shows. A task still being created (no number yet) always shows: it's yours, and just made. */
export const applyFilter = (tasks: ReadonlyArray<Task>, f: TaskFilter, c: MatchContext): Task[] =>
  tasks.filter((t) => t.number === 0 || matches(t, f, c))

/**
 * How many tasks a value of `field` would show, given the other active filters (faceted counts, as in
 * a shop's filters). `value` sets the field to just that value. Labels count with `labelCount`.
 */
export const countWith = (
  tasks: ReadonlyArray<Task>,
  f: TaskFilter,
  c: MatchContext,
  field: Exclude<FilterField, "labels">,
  value: Partial<TaskFilter>,
): number => {
  const probe = { ...f, ...value }
  return tasks.filter((t) => passes(t, f, c, field) && check[field](t, probe, c)).length
}

/** How many tasks carry the label `name` and pass every other filter, its own group's picks left out. */
export const labelCount = (tasks: ReadonlyArray<Task>, f: TaskFilter, c: MatchContext, name: string): number => {
  const labels = c.labels.get(name.toLowerCase()) ?? []
  return tasks.filter((t) => labels.some((l) => t.labelIds.includes(l.id) && passes(t, f, c, { group: l.group }))).length
}

// ---------- URL ----------

/** The filter's search params: `?label=bug,agents&priority=urgent&who=agent&session=<id>&by=human&waiting=review&due=overdue&updated=day&q=drag`. */
export interface FilterSearch {
  readonly label?: string
  readonly priority?: string
  readonly who?: string
  readonly session?: string
  readonly by?: string
  readonly waiting?: string
  readonly due?: string
  readonly updated?: Updated
  readonly q?: string
}

const PRIORITY_WORDS: Record<Priority, string> = { 0: "none", 1: "urgent", 2: "high", 3: "medium", 4: "low" }
const words = (v: unknown): string[] =>
  typeof v === "string" && v !== "" ? [...new Set(v.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))] : []
const pick = <T extends string>(values: ReadonlyArray<string>, allowed: ReadonlyArray<T>): T[] =>
  values.filter((v): v is T => (allowed as ReadonlyArray<string>).includes(v))

/** The filter a search names. Unknown values are dropped. */
export const filterFromSearch = (s: Record<string, unknown>): TaskFilter => ({
  labels: words(s["label"]),
  priority: words(s["priority"]).flatMap((w) => {
    const entry = Object.entries(PRIORITY_WORDS).find(([, word]) => word === w)
    return entry ? [Number(entry[0]) as Priority] : []
  }),
  holder: pick(words(s["who"]), ["agent", "human", "nobody"] as const),
  // Ids, so their case stays.
  sessions: typeof s["session"] === "string" && s["session"] !== ""
    ? [...new Set(s["session"].split(",").map((v) => v.trim()).filter(Boolean))]
    : [],
  maker: pick(words(s["by"]), ["agent", "human"] as const),
  waiting: pick(words(s["waiting"]), ["review", "input"] as const),
  due: pick(words(s["due"]), ["overdue", "week", "none"] as const),
  updated: s["updated"] === "day" || s["updated"] === "week" ? s["updated"] : null,
  text: typeof s["q"] === "string" ? s["q"] : typeof s["q"] === "number" ? String(s["q"]) : "",
})

/** The search params for a filter; every empty field is undefined, which removes its param. */
export const searchFromFilter = (f: TaskFilter): { [K in keyof Required<FilterSearch>]: Required<FilterSearch>[K] | undefined } => ({
  label: f.labels.length ? f.labels.join(",") : undefined,
  priority: f.priority.length ? f.priority.map((p) => PRIORITY_WORDS[p]).join(",") : undefined,
  who: f.holder.length ? f.holder.join(",") : undefined,
  session: f.sessions.length ? f.sessions.join(",") : undefined,
  by: f.maker.length ? f.maker.join(",") : undefined,
  waiting: f.waiting.length ? f.waiting.join(",") : undefined,
  due: f.due.length ? f.due.join(",") : undefined,
  updated: f.updated ?? undefined,
  q: f.text.trim() ? f.text : undefined,
})

const defined = (search: ReturnType<typeof searchFromFilter>): FilterSearch =>
  Object.fromEntries(Object.entries(search).filter(([, v]) => v !== undefined)) as FilterSearch

/** The router's `validateSearch` part: only the params a filter sets. */
export const parseFilterSearch = (s: Record<string, unknown>): FilterSearch => defined(searchFromFilter(filterFromSearch(s)))

// ---------- this device's copy ----------

/** The filter as this device keeps it: its search params as JSON, or "" for none. */
export const storedFilter = (f: TaskFilter): string => (hasFilter(f) ? JSON.stringify(defined(searchFromFilter(f))) : "")

/** A kept filter read back; missing or unreadable is no filter. */
export const parseStoredFilter = (raw: string | null): TaskFilter => {
  if (!raw) return EMPTY_FILTER
  try {
    const parsed: unknown = JSON.parse(raw)
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? filterFromSearch(parsed as Record<string, unknown>) : EMPTY_FILTER
  } catch {
    return EMPTY_FILTER
  }
}
