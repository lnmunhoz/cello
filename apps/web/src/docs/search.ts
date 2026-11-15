// What the Docs tab and the page reader keep in the URL, so a link reopens the same view. (`?embed`
// is the root route's, lib/embed.ts.)
import type { DocumentKind } from "@cello/contract/entities"

const KINDS: ReadonlyArray<DocumentKind> = ["doc", "spec", "page"]

export interface DocsSearch {
  /** Only this kind; none shows every document. */
  readonly kind?: DocumentKind
}

export const parseDocsSearch = (search: Record<string, unknown>): DocsSearch =>
  KINDS.includes(search["kind"] as DocumentKind) ? { kind: search["kind"] as DocumentKind } : {}

export interface PageSearch {
  /** An older version; none is the latest, which updates live. */
  readonly version?: number
}

export const parsePageSearch = (search: Record<string, unknown>): PageSearch => {
  const version = Number(search["version"])
  return Number.isInteger(version) && version > 0 ? { version } : {}
}
