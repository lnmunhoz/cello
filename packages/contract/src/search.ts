// What `search.query` returns (CEL-11, CEL-43): one server-side search behind the ⌘K bar and
// `cello search`, so the two never disagree. Hits come grouped by kind, best match first, with the
// matched words as [start, end) ranges into each text.
import * as Schema from "effect/Schema"
import { DocumentKind, Id, ReviewDecision } from "./entities.ts"

/** What a hit is. `packet` is a review packet; `document` a doc, spec or page. */
export const SearchKind = Schema.Literals(["task", "comment", "packet", "document", "project", "label"])
export type SearchKind = typeof SearchKind.Type

/** Every kind, in the order results are grouped. */
export const SEARCH_KINDS: ReadonlyArray<SearchKind> = ["task", "comment", "packet", "document", "project", "label"]

/** [start, end) offsets into a string. */
export const SearchRange = Schema.Tuple([Schema.Number, Schema.Number])

export const SearchHit = Schema.Struct({
  kind: SearchKind,
  /** The row's id: the task, comment, review, document, project or label. */
  id: Id,
  projectKey: Schema.String,
  /** The task it is or is on (tasks, comments, packets); null for documents, projects and labels. */
  taskId: Schema.NullOr(Id),
  taskKey: Schema.NullOr(Schema.String),
  /** A task's or document's title, the task's title for a comment or packet, a project's or label's name. */
  title: Schema.String,
  titleRanges: Schema.Array(SearchRange),
  /** One line of the matched text around the first match, cut with "…". */
  snippet: Schema.String,
  snippetRanges: Schema.Array(SearchRange),
  /**
   * The matched text, long enough to read without opening it: a task's description, a comment, a
   * packet's summary and steps, a document's summary and body (clipped around its first match).
   */
  text: Schema.String,
  textRanges: Schema.Array(SearchRange),
  /** Who wrote it (comments and packets) or last saved it (documents); null otherwise. */
  author: Schema.NullOr(Schema.String),
  /** When it was written (comments, packets) or last changed (tasks, documents). */
  at: Schema.Number,
  /** A task's status name, or the status of the task a comment or packet is on. */
  status: Schema.NullOr(Schema.String),
  /** A packet's decision: null while it's open. */
  decision: Schema.NullOr(ReviewDecision),
  docKind: Schema.NullOr(DocumentKind),
  slug: Schema.NullOr(Schema.String),
  /** A project's or label's color. */
  color: Schema.NullOr(Schema.String),
})
export type SearchHit = typeof SearchHit.Type

export const SearchGroup = Schema.Struct({
  kind: SearchKind,
  /** How many matched in all; `hits` holds the best of them. */
  total: Schema.Number,
  hits: Schema.Array(SearchHit),
})
export type SearchGroup = typeof SearchGroup.Type

export const SearchResults = Schema.Struct({
  query: Schema.String,
  /** The query's words, as matched (each the start of a word). Empty for a task key. */
  terms: Schema.Array(Schema.String),
  /** The task key the query is ("CEL-15"), or null. */
  key: Schema.NullOr(Schema.String),
  /** The task that key names, when it exists: where Enter jumps. */
  jump: Schema.NullOr(SearchHit),
  /** Non-empty groups, in SEARCH_KINDS order. For a key: what mentions it, or is on that task. */
  groups: Schema.Array(SearchGroup),
})
export type SearchResults = typeof SearchResults.Type
