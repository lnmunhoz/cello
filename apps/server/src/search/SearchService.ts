// One search for the ⌘K bar and `cello search` (CEL-11, CEL-43), so the two never disagree. Tasks,
// comments, review packets and documents come from the FTS5 index migration 0008 keeps in step with
// every write; project and label names (a handful) are matched here.
//
// - Words: each matches the start of a word, all of them required ("evid vid"). Both indexes answer:
//   `search_words` for prefixes as you type ("eviden"), `search_stems` for stems ("videos" → video);
//   each row keeps its better score. Only titles and bodies are searched, so "cel" finds Cello, not
//   every CEL task's key.
// - A task key ("CEL-15"): the task itself (`jump`), then every task, comment, packet and document
//   that names it, or is on it, as a phrase ("cel 15", so CEL-150 doesn't match).
// - Ranking: bm25 with a key match 20×, a title match 10×, a body match 1×; a Done or Canceled task
//   counts 0.8× (an open task wins a near tie); then the newer first. Groups come in a fixed order.
import type { DocumentKind, Project, ProjectRef, ReviewDecision, StatusCategory } from "@cello/contract/entities"
import { Invalid, NotFound } from "@cello/contract/errors"
import { SEARCH_KINDS, type SearchGroup, type SearchHit, type SearchKind, type SearchResults } from "@cello/contract/search"
import { clipAround, fromMarked, MARK_CLOSE, MARK_OPEN, matchesAll, oneLine, searchTerms, wordPrefixRanges, type Marked } from "@cello/shared/search"
import { isClosedCategory } from "@cello/shared/status"
import { formatTaskKey, parseTaskKey } from "@cello/shared/taskKey"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as SqlClient from "effect/sql/SqlClient"
import { selectLabels, selectProjects } from "../persistence/rows.ts"
import * as ProjectService from "../project/ProjectService.ts"

export interface SearchQuery {
  readonly query: string
  /** Search this workspace (the ⌘K bar). Without it, `project` alone (`cello search`). */
  readonly workspaceId?: string
  readonly project?: ProjectRef
  /** Default: every kind. */
  readonly kinds?: ReadonlyArray<SearchKind>
  /** Hits per kind: 1 to 50, default 5. */
  readonly limit?: number
}

export class SearchService extends Context.Service<SearchService, {
  readonly query: (input: SearchQuery) => Effect.Effect<SearchResults, NotFound | Invalid>
}>()("cello/SearchService") {}

export const DEFAULT_LIMIT = 5
export const MAX_LIMIT = 50
/** bm25 column weights: task_key, title, body. */
const WEIGHTS = "20.0, 10.0, 1.0"
/** A closed task's score, against an open one's. */
const CLOSED_FACTOR = 0.8
/** How long a hit's `text` gets, around its first match. */
const TEXT_MAX = 2000
/** How long its `snippet` gets: FTS5 picks the window, this caps it. */
const SNIPPET_TOKENS = 24
const SNIPPET_MAX = 240

type IndexTable = "search_words" | "search_stems"
type IndexedKind = "task" | "comment" | "packet" | "document"
const INDEXED: ReadonlySet<SearchKind> = new Set(["task", "comment", "packet", "document"])

interface Candidate {
  readonly id: number
  readonly kind: IndexedKind
  readonly refId: string
  readonly projectId: string
  readonly taskId: string | null
  readonly score: number
  readonly taskUpdatedAt: number
  readonly table: IndexTable
}

const placeholders = (values: ReadonlyArray<unknown>) => values.map(() => "?").join(", ")

/** Best first: score, then the task changed most recently, then the entry written last. */
const byRank = (a: Candidate, b: Candidate) => b.score - a.score || b.taskUpdatedAt - a.taskUpdatedAt || b.id - a.id

const plain = (text: string): Marked => ({ text, ranges: [] })

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const projects = yield* ProjectService.ProjectService

  /** The projects to search: a workspace's live ones, or the one `project` names. */
  const scopeOf = (input: SearchQuery) =>
    Effect.gen(function* () {
      if (input.workspaceId !== undefined) {
        const [workspace] = yield* sql<{ id: string }>`SELECT id FROM workspaces WHERE id = ${input.workspaceId} AND archived_at IS NULL`
        if (!workspace) return yield* new NotFound({ entity: "workspace", id: input.workspaceId })
        return yield* selectProjects(sql, sql`p.workspace_id = ${workspace.id} AND p.archived_at IS NULL`)
      }
      if (input.project !== undefined) return [yield* projects.resolve(input.project)]
      return yield* new Invalid({ field: "project", reason: "say which workspace or project to search" })
    })

  /** Every row `match` finds in one index, within the projects and kinds, scored. */
  const candidates = (table: IndexTable, match: string, projectIds: ReadonlyArray<string>, kinds: ReadonlyArray<string>) =>
    sql.unsafe<{
      id: number
      kind: IndexedKind
      ref_id: string
      project_id: string
      task_id: string | null
      rank: number
      category: StatusCategory | null
      task_updated_at: number | null
    }>(
      `SELECT e.id, e.kind, e.ref_id, e.project_id, e.task_id, bm25(${table}, ${WEIGHTS}) AS rank,
              s.category, t.updated_at AS task_updated_at
       FROM ${table} JOIN search_entries e ON e.id = ${table}.rowid
       LEFT JOIN tasks t ON t.id = e.task_id LEFT JOIN statuses s ON s.id = t.status_id
       WHERE ${table} MATCH ? AND e.project_id IN (${placeholders(projectIds)}) AND e.kind IN (${placeholders(kinds)})
         AND (e.task_id IS NULL OR t.archived_at IS NULL)`,
      [match, ...projectIds, ...kinds],
    ).pipe(Effect.map((rows) =>
      rows.map((r): Candidate => ({
        id: r.id,
        kind: r.kind,
        refId: r.ref_id,
        projectId: r.project_id,
        taskId: r.task_id,
        score: -r.rank * (r.kind === "task" && r.category !== null && isClosedCategory(r.category) ? CLOSED_FACTOR : 1),
        taskUpdatedAt: r.task_updated_at ?? 0,
        table,
      }))
    ))

  /** The title, body and a snippet of each picked row, marked where `match` matched, from the index it was found in. */
  const highlights = (table: IndexTable, match: string, ids: ReadonlyArray<number>) =>
    ids.length === 0
      ? Effect.succeed(new Map<number, { title: Marked; body: Marked; snippet: Marked }>())
      : sql.unsafe<{ id: number; title: string; body: string; snippet: string }>(
        `SELECT rowid AS id,
                highlight(${table}, 1, ?, ?) AS title,
                highlight(${table}, 2, ?, ?) AS body,
                snippet(${table}, 2, ?, ?, '…', ${SNIPPET_TOKENS}) AS snippet
         FROM ${table} WHERE ${table} MATCH ? AND rowid IN (${placeholders(ids)})`,
        [MARK_OPEN, MARK_CLOSE, MARK_OPEN, MARK_CLOSE, MARK_OPEN, MARK_CLOSE, match, ...ids],
      ).pipe(Effect.map((rows) =>
        new Map(rows.map((r) => [r.id, { title: fromMarked(r.title), body: fromMarked(r.body), snippet: fromMarked(r.snippet) }]))
      ))

  /** What a hit shows besides its text: titles, statuses, authors and times, for each kind's picked rows. */
  const details = (picked: ReadonlyArray<Candidate>) =>
    Effect.gen(function* () {
      const idsOf = (kind: IndexedKind) => picked.filter((c) => c.kind === kind).map((c) => c.refId)
      const taskIds = [...new Set(picked.flatMap((c) => (c.taskId ? [c.taskId] : [])))]
      const query = <R extends object>(ids: ReadonlyArray<string>, text: string) =>
        ids.length === 0 ? Effect.succeed([] as ReadonlyArray<R>) : sql.unsafe<R>(text.replace("(?)", `(${placeholders(ids)})`), [...ids])
      const tasks = yield* query<{ id: string; key: string; title: string; updated_at: number; status: string }>(taskIds, `
        SELECT t.id, p.key || '-' || t.number AS key, t.title, t.updated_at, s.name AS status
        FROM tasks t JOIN projects p ON p.id = t.project_id JOIN statuses s ON s.id = t.status_id WHERE t.id IN (?)`)
      const comments = yield* query<{ id: string; created_at: number; author: string }>(idsOf("comment"), `
        SELECT c.id, c.created_at, a.name AS author FROM comments c JOIN actors a ON a.id = c.actor_id WHERE c.id IN (?)`)
      const packets = yield* query<{ id: string; created_at: number; author: string; decision: ReviewDecision | null }>(idsOf("packet"), `
        SELECT r.id, r.created_at, r.decision, a.name AS author FROM reviews r JOIN actors a ON a.id = r.actor_id WHERE r.id IN (?)`)
      const documents = yield* query<{ id: string; kind: DocumentKind; slug: string; updated_at: number; author: string }>(idsOf("document"), `
        SELECT d.id, d.kind, d.slug, d.updated_at, a.name AS author FROM documents d JOIN actors a ON a.id = d.updated_by_actor_id WHERE d.id IN (?)`)
      return {
        tasks: new Map(tasks.map((t) => [t.id, t])),
        comments: new Map(comments.map((c) => [c.id, c])),
        packets: new Map(packets.map((p) => [p.id, p])),
        documents: new Map(documents.map((d) => [d.id, d])),
      }
    })

  /** The index's hits for `match`: each kind's best `limit`, with every kind's total. */
  const indexed = (
    match: string,
    options: { projects: ReadonlyArray<Project>; kinds: ReadonlyArray<SearchKind>; limit: number; tables: ReadonlyArray<IndexTable>; skipTask: string | null },
  ) =>
    Effect.gen(function* () {
      const kinds = options.kinds.filter((k) => INDEXED.has(k))
      if (kinds.length === 0 || options.projects.length === 0) return []
      const projectIds = options.projects.map((p) => p.id)
      const best = new Map<number, Candidate>()
      for (const table of options.tables) {
        for (const c of yield* candidates(table, match, projectIds, kinds)) {
          if (c.kind === "task" && c.refId === options.skipTask) continue
          const seen = best.get(c.id)
          if (!seen || c.score > seen.score) best.set(c.id, c)
        }
      }
      const groups = kinds.flatMap((kind) => {
        const all = [...best.values()].filter((c) => c.kind === kind).sort(byRank)
        return all.length === 0 ? [] : [{ kind, total: all.length, picked: all.slice(0, options.limit) }]
      })
      const picked = groups.flatMap((g) => g.picked)
      const marks = new Map<number, { title: Marked; body: Marked; snippet: Marked }>()
      for (const table of options.tables) {
        const found = yield* highlights(table, match, picked.filter((c) => c.table === table).map((c) => c.id))
        for (const [id, m] of found) marks.set(id, m)
      }
      const more = yield* details(picked)
      const keyOf = new Map(options.projects.map((p) => [p.id, p.key]))

      const hitOf = (c: Candidate): SearchHit => {
        const m = marks.get(c.id) ?? { title: plain(""), body: plain(""), snippet: plain("") }
        const task = c.taskId ? more.tasks.get(c.taskId) : undefined
        const comment = c.kind === "comment" ? more.comments.get(c.refId) : undefined
        const packet = c.kind === "packet" ? more.packets.get(c.refId) : undefined
        const document = c.kind === "document" ? more.documents.get(c.refId) : undefined
        const title = c.kind === "task" || c.kind === "document" ? m.title : plain(task?.title ?? "")
        const snippet = clipAround(oneLine(m.snippet), SNIPPET_MAX)
        const text = clipAround(m.body, TEXT_MAX)
        return {
          kind: c.kind,
          id: c.refId,
          projectKey: keyOf.get(c.projectId) ?? "",
          taskId: c.taskId,
          taskKey: task?.key ?? null,
          title: title.text,
          titleRanges: title.ranges,
          snippet: snippet.text,
          snippetRanges: snippet.ranges,
          text: text.text,
          textRanges: text.ranges,
          author: comment?.author ?? packet?.author ?? document?.author ?? null,
          at: comment?.created_at ?? packet?.created_at ?? document?.updated_at ?? task?.updated_at ?? 0,
          status: task?.status ?? null,
          decision: packet?.decision ?? null,
          docKind: document?.kind ?? null,
          slug: document?.slug ?? null,
          color: null,
        }
      }
      return groups.map((g): SearchGroup => ({ kind: g.kind, total: g.total, hits: g.picked.map(hitOf) }))
    })

  /** Projects and labels whose names (or a project's key) start with every term. */
  const named = (terms: ReadonlyArray<string>, scope: ReadonlyArray<Project>, kinds: ReadonlyArray<SearchKind>, limit: number) =>
    Effect.gen(function* () {
      const groups: SearchGroup[] = []
      const base = { taskId: null, taskKey: null, snippet: "", snippetRanges: [], text: "", textRanges: [], author: null, status: null, decision: null, docKind: null, slug: null }
      if (kinds.includes("project")) {
        const hits = scope
          .filter((p) => matchesAll([p.name, p.key], terms))
          .map((p): SearchHit => ({ ...base, kind: "project", id: p.id, projectKey: p.key, title: p.name, titleRanges: wordPrefixRanges(p.name, terms), at: p.updatedAt, color: p.color }))
        if (hits.length > 0) groups.push({ kind: "project", total: hits.length, hits: hits.slice(0, limit) })
      }
      if (kinds.includes("label") && scope.length > 0) {
        // Labels belong to a project (CEL-80): the searched projects' own, each with its project's key.
        const keyOf = new Map(scope.map((p) => [p.id, p.key]))
        const labels = yield* selectLabels(sql, sql`${sql.in("l.project_id", scope.map((p) => p.id))} AND l.archived_at IS NULL`)
        const hits = labels
          .filter((l) => matchesAll([l.name], terms))
          .map((l): SearchHit => ({ ...base, kind: "label", id: l.id, projectKey: keyOf.get(l.projectId) ?? "", title: l.name, titleRanges: wordPrefixRanges(l.name, terms), at: l.updatedAt, color: l.color }))
        if (hits.length > 0) groups.push({ kind: "label", total: hits.length, hits: hits.slice(0, limit) })
      }
      return groups
    })

  /** The task a key names, in the searched projects and not archived, as a hit to jump to. */
  const jumpTo = (key: { projectKey: string; number: number }, scope: ReadonlyArray<Project>) =>
    Effect.gen(function* () {
      const project = scope.find((p) => p.key === key.projectKey)
      if (!project) return null
      const [task] = yield* sql<{ id: string; title: string; description: string; updated_at: number; status: string }>`
        SELECT t.id, t.title, t.description, t.updated_at, s.name AS status FROM tasks t JOIN statuses s ON s.id = t.status_id
        WHERE t.project_id = ${project.id} AND t.number = ${key.number} AND t.archived_at IS NULL`
      if (!task) return null
      const snippet = clipAround(oneLine(plain(task.description)), SNIPPET_MAX)
      return {
        kind: "task",
        id: task.id,
        projectKey: project.key,
        taskId: task.id,
        taskKey: formatTaskKey(project.key, key.number),
        title: task.title,
        titleRanges: [],
        snippet: snippet.text,
        snippetRanges: [],
        text: clipAround(plain(task.description), TEXT_MAX).text,
        textRanges: [],
        author: null,
        at: task.updated_at,
        status: task.status,
        decision: null,
        docKind: null,
        slug: null,
        color: null,
      } satisfies SearchHit
    })

  const query = Effect.fn("SearchService.query")(function* (input: SearchQuery) {
    const limit = input.limit ?? DEFAULT_LIMIT
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return yield* new Invalid({ field: "limit", reason: `the number of hits per kind (limit) must be a whole number from 1 to ${MAX_LIMIT}` })
    }
    const scope = yield* scopeOf(input)
    const kinds = SEARCH_KINDS.filter((k) => input.kinds === undefined || input.kinds.includes(k))
    const key = parseTaskKey(input.query)

    if (key) {
      const literal = formatTaskKey(key.projectKey, key.number)
      const jump = yield* jumpTo(key, scope)
      const groups = yield* indexed(`{task_key body} : "${key.projectKey.toLowerCase()} ${key.number}"`, {
        projects: scope,
        kinds,
        limit,
        tables: ["search_words"],
        skipTask: jump?.id ?? null,
      })
      return { query: input.query, terms: [], key: literal, jump, groups } satisfies SearchResults
    }

    const terms = searchTerms(input.query)
    if (terms.length === 0) return { query: input.query, terms, key: null, jump: null, groups: [] } satisfies SearchResults
    const match = `{title body} : (${terms.map((t) => `"${t}"*`).join(" ")})`
    const groups = [
      ...(yield* indexed(match, { projects: scope, kinds, limit, tables: ["search_words", "search_stems"], skipTask: null })),
      ...(yield* named(terms, scope, kinds, limit)),
    ]
    return { query: input.query, terms, key: null, jump: null, groups } satisfies SearchResults
  }, Effect.catchTag("SqlError", Effect.die))

  return SearchService.of({ query })
})

export const layer = Layer.effect(SearchService, make)
