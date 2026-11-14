// What the Docs tab and the page reader keep in the URL, so a link reopens the same view.
import type { DocumentKind } from "@cello/contract/entities"
import { isEmbed } from "../lib/embed.ts"

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
  /** Shown in a panel, without the app shell. */
  readonly embed?: 1
}

export const parsePageSearch = (search: Record<string, unknown>): PageSearch => {
  const version = Number(search["version"])
  return {
    ...(Number.isInteger(version) && version > 0 ? { version } : {}),
    ...(isEmbed(search) ? { embed: 1 as const } : {}),
  }
}
