// What the ⌘K bar lists for a search (CEL-43): the server's groups as sections in a fixed order, with
// projects and labels together; a key's mentions as one section; Palette keeps each kind short so
// every kind fits without scrolling, Peek narrows to one kind with its scope tabs.
import type { SearchHit, SearchKind, SearchResults } from "@cello/contract/search"
import type { BarLayout } from "./layout.ts"

/** Peek's scope tabs. */
export type Scope = "all" | "task" | "comment" | "packet" | "document" | "project"

export const SCOPES: ReadonlyArray<{ readonly id: Scope; readonly label: string }> = [
  { id: "all", label: "All" },
  { id: "task", label: "Tasks" },
  { id: "comment", label: "Comments" },
  { id: "packet", label: "Packets" },
  { id: "document", label: "Docs" },
  { id: "project", label: "Projects" },
]

export const scopeOf = (kind: SearchKind): Exclude<Scope, "all"> => (kind === "label" ? "project" : kind)

export interface Section {
  /** Unique among the sections; Palette and Peek list the same ids. */
  readonly id: string
  readonly label: string
  readonly hits: ReadonlyArray<SearchHit>
  /** How many matched in all, when more than shown. */
  readonly total: number
}

const LABELS: Record<Exclude<Scope, "all">, string> = {
  task: "Tasks",
  comment: "Comments",
  packet: "Review packets",
  document: "Pages and docs",
  project: "Projects and labels",
}

/** Palette's cap per section, so each kind fits on screen. */
export const PALETTE_CAP: Record<Exclude<Scope, "all">, number> = { task: 4, comment: 2, packet: 2, document: 3, project: 3 }

/** How many matched of each scope (and all), for the tabs' counts. */
export const scopeCounts = (results: SearchResults | null): Record<Scope, number> => {
  const counts: Record<Scope, number> = { all: 0, task: 0, comment: 0, packet: 0, document: 0, project: 0 }
  for (const g of results?.groups ?? []) {
    counts[scopeOf(g.kind)] += g.total
    counts.all += g.total
  }
  return counts
}

export const sectionsOf = (results: SearchResults | null, layout: BarLayout, scope: Scope): Section[] => {
  if (!results) return []
  const wanted = layout === "peek" && scope !== "all" ? results.groups.filter((g) => scopeOf(g.kind) === scope) : results.groups
  if (results.key !== null) {
    const hits = wanted.flatMap((g) => g.hits)
    const total = wanted.reduce((n, g) => n + g.total, 0)
    if (hits.length === 0) return []
    return [{ id: "mentions", label: `Mentions ${results.key}`, hits: layout === "palette" ? hits.slice(0, 6) : hits, total }]
  }
  const sections: Section[] = []
  for (const g of wanted) {
    const id = scopeOf(g.kind)
    const at = sections.findIndex((s) => s.id === id)
    if (at === -1) sections.push({ id, label: LABELS[id], hits: g.hits, total: g.total })
    else sections[at] = { ...sections[at]!, hits: [...sections[at]!.hits, ...g.hits], total: sections[at]!.total + g.total }
  }
  return layout === "palette" ? sections.map((s) => ({ ...s, hits: s.hits.slice(0, PALETTE_CAP[s.id as Exclude<Scope, "all">]) })) : sections
}

/** A hit's value in the list: unique across kinds. */
export const hitValue = (hit: SearchHit): string => `${hit.kind}:${hit.id}`
