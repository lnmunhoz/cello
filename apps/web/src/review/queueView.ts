// How the Agents and Review pages narrow their rows (CEL-188), kept pure: the project pick, kept on this
// device (the project's key, not its id, resolved against the workspace on every render), and the chips
// that offer it. Counts come from the whole list, not the filtered view, so rows stay put while you filter
// (the board's facet rule, issues/facets.ts).
import type { Project } from "@cello/contract/entities"

export type QueuePage = "agents" | "review"

/** The localStorage key of one saved setting of a page: `cello:agents:project`. */
export const viewKey = (page: QueuePage, what: "project" | "sort"): string => `cello:${page}:${what}`

/** A page's saved sort: one it offers, else its default (the first). */
export const parseSort = <S extends string>(stored: string | null, sorts: ReadonlyArray<S>): S => sorts.find((s) => s === stored) ?? sorts[0]!

/** What a pick of All is stored as. */
export const ALL = "all"

/** The project a stored pick names, else null (All): a key that isn't a project of this workspace is All. */
export const parseProjectPick = (stored: string | null, projects: ReadonlyArray<Project>): Project | null =>
  stored === null ? null : (projects.find((p) => p.key === stored) ?? null)

export interface ProjectChip {
  readonly project: Project
  readonly count: number
}

export interface ProjectChips {
  /** Every row, whatever its project (rows with none too). */
  readonly all: number
  /** The projects with a row, A to Z (as `projects` is), and the picked one even with none. */
  readonly chips: ReadonlyArray<ProjectChip>
}

/** The chips for rows whose projects are `projectIds` (null: a row with no project). */
export const projectChips = (projectIds: ReadonlyArray<string | null>, projects: ReadonlyArray<Project>, picked: Project | null): ProjectChips => ({
  all: projectIds.length,
  chips: projects
    .map((project) => ({ project, count: projectIds.filter((id) => id === project.id).length }))
    .filter((chip) => chip.count > 0 || chip.project.id === picked?.id),
})
