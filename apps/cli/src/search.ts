// `cello search` as text (CEL-11): each kind under its heading with a count, one line per hit (its
// key or slug, who and when), the matched text under it, matched words in [brackets].
import type { SearchHit, SearchKind, SearchResults } from "@cello/contract/search"
import { type Range, segments } from "@cello/text/search"
import { ago, columns } from "./format.ts"

const HEADINGS: Record<SearchKind, string> = {
  task: "Tasks",
  comment: "Comments",
  packet: "Review packets",
  document: "Pages and docs",
  project: "Projects",
  label: "Labels",
}

const DECISIONS = { approved: "approved", sent_back: "sent back", superseded: "superseded", withdrawn: "withdrawn" } as const

/** `--kind` names: documents answer to page, doc or spec. */
const KIND_NAMES: Record<string, SearchKind> = {
  task: "task",
  comment: "comment",
  packet: "packet",
  page: "document",
  doc: "document",
  spec: "document",
  project: "project",
  label: "label",
}

/** The kinds a `--kind` value names (comma-separated), in order, once each. Throws a sentence naming the real kinds. */
export const kindsOf = (value: string): SearchKind[] => {
  const kinds: SearchKind[] = []
  for (const name of value.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    const kind = KIND_NAMES[name]
    if (!kind) throw new Error(`No kind "${name}". Kinds: task, comment, packet, page, project, label.`)
    if (!kinds.includes(kind)) kinds.push(kind)
  }
  return kinds
}

/** Text with its matched ranges in [brackets]. */
export const bracketed = (text: string, ranges: ReadonlyArray<Range>): string =>
  segments(text, ranges).map((s) => (s.match ? `[${s.text}]` : s.text)).join("")

/** The hit's columns on its line: what it is, then its title with matches marked. */
const head = (hit: SearchHit, now: number): string[] => {
  const title = bracketed(hit.title, hit.titleRanges)
  switch (hit.kind) {
    case "task":
      return [hit.taskKey ?? "", hit.status ?? "", title]
    case "comment":
      return [hit.taskKey ?? "", `${hit.author ?? "Someone"}, ${ago(hit.at, now)}, on ${title}`]
    case "packet":
      return [hit.taskKey ?? "", `${hit.author ?? "Someone"}, ${ago(hit.at, now)}, ${hit.decision ? DECISIONS[hit.decision] : "open"}, on ${title}`]
    case "document":
      return [hit.slug ?? "", hit.docKind ?? "", `${title}  · ${hit.author ?? "Someone"}, ${ago(hit.at, now)}`]
    case "project":
      return [hit.projectKey, title]
    case "label":
      return [title]
  }
}

/** A comment's or packet's words are always worth a line; another hit's only when they matched. */
const showsSnippet = (hit: SearchHit) => hit.snippet !== "" && (hit.kind === "comment" || hit.kind === "packet" || hit.snippetRanges.length > 0)

const groupLines = (kind: SearchKind, total: number, hits: ReadonlyArray<SearchHit>, now: number): string[] => {
  const cells = hits.map((h) => head(h, now))
  const heads = columns(cells)
  // The snippet lines up under the title, past the first column (the key or slug).
  const indent = " ".repeat(2 + Math.max(...cells.map((c) => c[0]!.length)) + 2)
  return [
    `${HEADINGS[kind]} (${hits.length < total ? `${hits.length} of ${total}` : total})`,
    ...hits.flatMap((h, i) => [`  ${heads[i]}`, ...(showsSnippet(h) ? [`${indent}${bracketed(h.snippet, h.snippetRanges)}`] : [])]),
  ]
}

export const searchText = (results: SearchResults, options: { readonly now: number; readonly scope: string }): string => {
  const { now, scope } = options
  const lines: string[] = []
  if (results.key !== null) {
    if (results.jump) lines.push(columns([head(results.jump, now)])[0]!)
    if (results.groups.length === 0) {
      return results.jump ? `${lines[0]}\n\nNothing else mentions ${results.key}.` : `No task ${results.key} in ${scope}, and nothing mentions it.`
    }
    if (results.jump) lines.push("")
    lines.push(`Mentions ${results.key}`)
  } else if (results.groups.length === 0) {
    return `Nothing in ${scope} matches "${results.query}". Search looks at task keys, titles and descriptions, comments, review packets, docs, projects and labels.`
  }
  for (const group of results.groups) lines.push(...groupLines(group.kind, group.total, group.hits, now))
  const cut = results.groups.find((g) => g.hits.length < g.total)
  if (cut) lines.push("", `More: \`--limit 20\` shows more per kind; \`--kind ${cut.kind === "document" ? "page" : cut.kind}\` shows only one kind.`)
  return lines.join("\n")
}
