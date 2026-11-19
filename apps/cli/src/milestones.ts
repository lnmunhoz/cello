// Milestones in the CLI (CEL-113): `cello milestone list|show|create|edit|close|reopen`, `--milestone` on
// `task create|edit|list`, and the milestone lines of `cello task get` and `cello context`. The pure parts:
// reading `--due`, and the text. Names are matched by @cello/domain/milestone's findMilestone, as on the server.
import type { Milestone } from "@cello/contract/entities"
import type { MilestoneList, MilestoneProgress, MilestoneSummary } from "@cello/contract/views"
import { progressParts, progressText } from "@cello/domain/milestone"
import { ago, columns } from "./format.ts"

/** `--due 2026-12-01`, or `none` to clear the date. */
export const parseDue = (value: string): string | null | { readonly invalid: string } => {
  const trimmed = value.trim()
  if (trimmed.toLowerCase() === "none") return null
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? trimmed
    : { invalid: `--due takes a date like 2026-12-01, or none to clear it; "${value}" isn't one.` }
}

/** "M3 · due 2026-12-01 · Watching agents": what `create` and `edit` print. */
export const milestoneLine = (m: Milestone): string =>
  [m.name, ...(m.targetDate ? [`due ${m.targetDate}`] : []), ...(m.goal ? [m.goal] : [])].join(" · ")

/** "due 2026-12-01" while open, "closed 2d ago" once closed. */
const when = (m: Milestone, now: number) => (m.state === "closed" ? `closed ${ago(m.closedAt ?? m.updatedAt, now)}` : m.targetDate ? `due ${m.targetDate}` : "")

/** `cello milestone list`: each milestone in the project's order with its state, progress, date and goal. */
export const milestoneListText = (list: MilestoneList, now: number): string => {
  if (list.milestones.length === 0) return `No milestones yet in ${list.project.key}. Make one with \`cello milestone create <name> --goal "…"\`.`
  return columns(list.milestones.map(({ milestone: m, progress }) => {
    const rest = [when(m, now), m.goal].filter((part) => part !== "").join(" · ")
    return [m.name, m.state, progressText(progress), ...(rest ? [rest] : [])]
  })).join("\n")
}

/** "6 of 11 done · 55%: 1 in review, 2 in progress, 1 to do, 1 in Backlog (2 canceled, not counted)". */
export const progressDetail = (p: MilestoneProgress): string => {
  const left = progressParts(p)
  const canceled = p.canceled ? ` (${p.canceled} canceled, not counted)` : ""
  return `${progressText(p)}${left.length ? `: ${left.join(", ")}` : ""}${canceled}`
}

/** `cello milestone show`'s first lines: name, state and date, its goal, its progress. */
export const milestoneHeader = (m: Milestone, progress: MilestoneProgress, now: number): string[] => [
  [m.name, m.state === "closed" ? when(m, now) : "open", ...(m.state === "open" && m.targetDate ? [`due ${m.targetDate}`] : [])].join(" · "),
  ...(m.goal ? [m.goal] : []),
  progressDetail(progress),
]

/** `cello context`'s Milestones line: the open ones, "M3 1/2 done (due 2026-12-01)"; `all` counts closed ones too. */
export const contextMilestones = (open: ReadonlyArray<MilestoneSummary>, all: number): string => {
  if (open.length === 0) return all === 0 ? "none yet" : "none open"
  return open
    .map(({ milestone: m, progress: p }) => `${m.name} ${p.done}/${p.total} done${m.targetDate ? ` (due ${m.targetDate})` : ""}`)
    .join(" · ")
}
