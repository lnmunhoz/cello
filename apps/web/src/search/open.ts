// Where a ⌘K result goes when it's opened (CEL-43), and the recent places the bar lists when it's
// empty. Pure, so the rules are tested without a browser.
import type { SearchHit } from "@cello/contract/search"
import { parseTaskKey } from "@cello/shared/taskKey"

export type Target =
  /** A task in the panel, or as a full page; `comment`: scrolled to that comment, which flashes once. */
  | { readonly to: "task"; readonly projectKey: string; readonly number: number; readonly full: boolean; readonly comment?: string }
  /** The Review page with this task's packet open. */
  | { readonly to: "review"; readonly key: string }
  | { readonly to: "page"; readonly projectKey: string; readonly slug: string }
  | { readonly to: "issues"; readonly projectKey: string }
  | { readonly to: "settings" }

/**
 * Enter opens a hit; ⌘Enter (`full`) opens its task as a full page. A comment opens its task at the
 * comment; a packet still waiting for Lucas opens on the Review page; a label opens Settings, where
 * labels live.
 */
export const targetOf = (hit: SearchHit, full: boolean): Target | null => {
  const key = hit.taskKey ? parseTaskKey(hit.taskKey) : null
  switch (hit.kind) {
    case "task":
      return key ? { to: "task", ...key, full } : null
    case "comment":
      return key ? { to: "task", ...key, full, comment: hit.id } : null
    case "packet":
      if (hit.decision === null && !full && hit.taskKey) return { to: "review", key: hit.taskKey }
      return key ? { to: "task", ...key, full } : null
    case "document":
      return hit.slug ? { to: "page", projectKey: hit.projectKey, slug: hit.slug } : null
    case "project":
      return { to: "issues", projectKey: hit.projectKey }
    case "label":
      return { to: "settings" }
  }
}

/** A place opened from the bar, listed under Recent next time; titles come from the board when shown. */
export type RecentItem =
  | { readonly kind: "task"; readonly key: string }
  | { readonly kind: "document"; readonly projectKey: string; readonly slug: string }
  | { readonly kind: "project"; readonly projectKey: string }

export const RECENT_KEY = "cello:search-recent"
export const MAX_RECENT = 8

/** The recent place a target is, if it's one worth listing again. */
export const recentOf = (target: Target): RecentItem | null => {
  switch (target.to) {
    case "task":
      return { kind: "task", key: `${target.projectKey}-${target.number}` }
    case "review":
      return { kind: "task", key: target.key }
    case "page":
      return { kind: "document", projectKey: target.projectKey, slug: target.slug }
    case "issues":
      return { kind: "project", projectKey: target.projectKey }
    case "settings":
      return null
  }
}

const idOf = (item: RecentItem) =>
  item.kind === "task" ? `task:${item.key}` : item.kind === "document" ? `document:${item.projectKey}/${item.slug}` : `project:${item.projectKey}`

/** `item` first, the rest after it without it, at most MAX_RECENT. */
export const withRecent = (list: ReadonlyArray<RecentItem>, item: RecentItem): RecentItem[] =>
  [item, ...list.filter((other) => idOf(other) !== idOf(item))].slice(0, MAX_RECENT)

const isRecent = (value: unknown): value is RecentItem => {
  if (typeof value !== "object" || value === null) return false
  const v = value as Record<string, unknown>
  if (v["kind"] === "task") return typeof v["key"] === "string"
  if (v["kind"] === "document") return typeof v["projectKey"] === "string" && typeof v["slug"] === "string"
  if (v["kind"] === "project") return typeof v["projectKey"] === "string"
  return false
}

/** What this device saved; anything unreadable is dropped. */
export const readRecent = (stored: string | null): RecentItem[] => {
  try {
    const parsed: unknown = JSON.parse(stored ?? "[]")
    return Array.isArray(parsed) ? parsed.filter(isRecent).slice(0, MAX_RECENT) : []
  } catch {
    return []
  }
}
