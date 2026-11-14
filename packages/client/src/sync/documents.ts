// Documents in board state: the Docs tab's list, a reader's page by slug, and a task's linked pages.
import type { DocumentKind, DocumentSummary } from "@cello/contract/entities"
import type { BoardState } from "./applyEvents.ts"

const newestFirst = (a: DocumentSummary, b: DocumentSummary) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1)

/** A project's documents that aren't archived, newest first; `kind` narrows them. */
export const documentsOf = (state: BoardState, projectId: string, kind?: DocumentKind): DocumentSummary[] =>
  Object.values(state.documents)
    .filter((d) => d.projectId === projectId && d.archivedAt === null && (kind === undefined || d.kind === kind))
    .sort(newestFirst)

/** One document by its slug, archived or not: its link keeps working. */
export const documentBySlug = (state: BoardState, projectId: string, slug: string): DocumentSummary | undefined =>
  Object.values(state.documents).find((d) => d.projectId === projectId && d.slug === slug)

/** Documents a task links to that aren't archived, newest first. */
export const documentsOfTask = (state: BoardState, taskId: string): DocumentSummary[] =>
  Object.values(state.documents).filter((d) => d.archivedAt === null && d.tasks.some((t) => t.id === taskId)).sort(newestFirst)
