// The side panel's rules (the viewer): what a URL is (image, video, text file, Cello page, external
// site), where an "open" goes (`openRoute`: the image modal, the side panel, the desktop app's native
// browser, or the board's window), which document a Cello page shows, and the panel's width rule.
// Pure, so the rules are tested once here; the components only map a decision to the DOM.
import { attachmentIdOf } from "@cello/shared/attachment"
import { shortUrl } from "@cello/shared/linkify"
import { parseTaskKey, parseTaskPath, taskPath } from "@cello/shared/taskKey"
import { parseVersion } from "@cello/shared/updates"
import type { CelloDesktop } from "../lib/desktop.ts"
import type { WidthRule } from "../lib/resize.ts"

/**
 * image and video: shown as such. text: a text file on the board (a transcript, a log, markdown),
 * fetched and shown natively. page: the board's own origin (a document in the page reader, any other
 * route in an iframe). external: another site, an iframe attempt (in a browser).
 */
export type ViewerKind = "image" | "video" | "text" | "page" | "external"

export interface ViewerItem {
  /** Absolute http(s). */
  readonly url: string
  readonly title: string
  readonly kind: ViewerKind
  /** A text file's own name, when known: Download saves under it, and `.md` reads as markdown. */
  readonly name?: string
}

/** What a caller asks to open: a URL (absolute, or relative to the board), and what it knows about it. */
export interface OpenTarget {
  readonly url: string
  readonly title?: string | undefined
  /** Set for evidence known to be an image, a video or a text file, whatever its URL looks like. */
  readonly kind?: "image" | "video" | "text" | undefined
  /** The file's own name, when known. */
  readonly name?: string | undefined
  /** "viewer": Open in viewer, which asks for the side panel even for an image (else the image modal). */
  readonly place?: "viewer" | undefined
}

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i
const VIDEO = /\.(mp4|webm|mov|m4v|ogv)$/i
/** The text files the server stores (packages/shared/src/attachment.ts), by extension. */
const TEXT = /\.(txt|log|out|md|csv|json|cast)$/i

const resolve = (url: string, origin: string): URL | null => {
  if (url.trim() === "" || url.startsWith("#")) return null
  const parsed = URL.parse(url.trim(), origin)
  return parsed && (parsed.protocol === "http:" || parsed.protocol === "https:") ? parsed : null
}

/**
 * Null for anything that isn't a web page (javascript:, file:, mailto:, a bare #hash…). A stored file
 * (`/attachments/<id>`) nothing describes is text: the server stores only images, videos and text, and
 * the text view shows an image or a video it turns out to be as such.
 */
export const toViewerItem = (target: OpenTarget, origin: string): ViewerItem | null => {
  const url = resolve(target.url, origin)
  if (!url) return null
  const onBoard = url.origin === new URL(origin).origin
  const kind: ViewerKind =
    target.kind ??
    (IMAGE.test(url.pathname)
      ? "image"
      : VIDEO.test(url.pathname)
        ? "video"
        : !onBoard
          ? "external"
          : attachmentIdOf(url.pathname) !== null || TEXT.test(url.pathname)
            ? "text"
            : "page")
  const name = target.name?.trim()
  return { url: url.href, title: target.title?.trim() || name || shortUrl(url.href), kind, ...(name ? { name } : {}) }
}

/**
 * modal: the image modal. panel: the side panel, in this window. desktop: the desktop app's native
 * browser. parent: the board's window, from a Cello page framed in the side panel; it decides again.
 */
export type OpenRoute = "modal" | "panel" | "desktop" | "parent"

/**
 * The one rule for where an open goes (CEL-60): an image link to the image modal (Open in viewer moves
 * it to the side panel); a video, a text file and a Cello page to the side panel, in the desktop app as
 * in a browser; another site to the desktop app's native browser, or the side panel's iframe attempt in
 * a browser. The native browser is for outside sites only.
 */
export const openRoute = (item: ViewerItem, target: OpenTarget, where: { readonly desktop: boolean; readonly framed: boolean }): OpenRoute => {
  if (where.framed) return "parent"
  if (item.kind === "image" && target.place !== "viewer") return "modal"
  if (item.kind === "external" && where.desktop) return "desktop"
  return "panel"
}

/** A Cello page's document: its project, slug, pinned version and the section to open at. */
export interface PageRef {
  readonly projectKey: string
  readonly slug: string
  readonly version: number | undefined
  /** The section's id, without `#`; "" for the top. */
  readonly hash: string
}

/** The document a URL on the board shows (`/CEL/pages/notes?version=2#next`), or null for any other address. */
export const pageRef = (url: string, origin: string): PageRef | null => {
  const parsed = URL.parse(url)
  if (!parsed || parsed.origin !== new URL(origin).origin) return null
  const match = /^\/([^/]+)\/pages\/([^/]+)\/?$/.exec(parsed.pathname)
  if (!match) return null
  const version = Number(parsed.searchParams.get("version"))
  return {
    projectKey: decodeURIComponent(match[1]!),
    slug: decodeURIComponent(match[2]!),
    version: Number.isInteger(version) && version > 0 ? version : undefined,
    hash: decodeURIComponent(parsed.hash.slice(1)),
  }
}

/** The release a URL on the board shows (`/releases/0.5.1`, What's new, CEL-140), or null for any other address. */
export const releaseRef = (url: string, origin: string): string | null => {
  const parsed = URL.parse(url)
  if (!parsed || parsed.origin !== new URL(origin).origin) return null
  const match = /^\/releases\/([^/]+)\/?$/.exec(parsed.pathname)
  const version = match ? decodeURIComponent(match[1]!) : null
  return version && parseVersion(version) ? version : null
}

/** The task a link points at (`/CEL/3`, or that path on the board's origin), or null: such a link opens the task, as its key would. */
export const taskOfHref = (href: string | undefined, origin: string): { projectKey: string; number: number } | null => {
  const target = href && !href.startsWith("#") ? URL.parse(href, origin) : null
  return target?.origin === new URL(origin).origin ? parseTaskPath(target.pathname) : null
}

/**
 * The side panel's address for a task opened off its board (CEL-141): its path, with `?comment=<id>`
 * when ⌘K opened it at a comment (CEL-144), as the task's own route takes it, so Open in board keeps it.
 */
export const taskViewerPath = (task: { readonly projectKey: string; readonly number: number }, comment?: string): string =>
  comment ? `${taskPath(task.projectKey, task.number)}?${new URLSearchParams({ comment })}` : taskPath(task.projectKey, task.number)

/** The task the side panel shows (`?viewer=/THAI/96`) and the comment it opens at, or null when it shows something else. */
export const viewerTaskOf = (item: ViewerItem, origin: string): { projectKey: string; number: number; comment?: string } | null => {
  const task = item.kind === "page" ? taskOfHref(item.url, origin) : null
  if (!task) return null
  const comment = new URL(item.url).searchParams.get("comment")
  return comment ? { ...task, comment } : task
}

/** Where Expand to full page goes: the board's own address for `url`, without `?embed`. */
export const fullPageHref = (url: string): string => {
  const parsed = new URL(url)
  parsed.searchParams.delete("embed")
  return `${parsed.pathname}${parsed.search}${parsed.hash}`
}

/** `url` showing `version` of its page; undefined: the latest, which updates live. */
export const withVersion = (url: string, version: number | undefined): string => {
  const parsed = new URL(url)
  if (version === undefined) parsed.searchParams.delete("version")
  else parsed.searchParams.set("version", String(version))
  return parsed.href
}


/** This page is a Cello page inside a panel: framed, or opened with ?embed. It shows without the sidebar. */
export const isEmbedded = (win: { readonly self: unknown; readonly top: unknown; readonly search: string }): boolean =>
  win.self !== win.top || new URLSearchParams(win.search).has("embed")

/**
 * What asks the board's window to open a task there: a Cello page framed in the viewer (postMessage
 * to its parent), and the desktop app's preload for a task clicked in its native panel.
 */
export interface OpenTaskMessage {
  readonly type: "cello:task"
  readonly key: string
}

/** router: this is the board. parent: a Cello page framed in the viewer. link: a page alone in a panel (the desktop app's). */
export type TaskRoute = "router" | "parent" | "link"

/**
 * How a click on a task key opens the task in the main window, wherever the key is shown: on the
 * board, its router; from a page framed in the viewer, the board's window (an OpenTaskMessage); from a
 * page alone in a panel (`?embed`, the desktop app's native panel), the link itself, which the app
 * catches and opens on the board. In a browser tab with `?embed`, that link just opens the task there.
 */
export const taskRoute = (win: { readonly self: unknown; readonly top: unknown; readonly search: string }): TaskRoute =>
  win.self !== win.top ? "parent" : new URLSearchParams(win.search).has("embed") ? "link" : "router"

/**
 * board: the task docks beside its project's board or list (its address, `/THAI/96`). milestone: beside
 * the milestone's page you're on, in its task panel. panel: in the side panel of the page you're on
 * (`?viewer=/THAI/96`), which stays where it was.
 */
export type TaskOpen = { readonly type: "board" } | { readonly type: "milestone"; readonly milestoneId: string } | { readonly type: "panel" }

/**
 * Where a plain click on a task's link opens it, from the page at `pathname` (CEL-141): on the task's
 * own project's board or list, there, as it always did; on one of its project's milestone pages, beside
 * that page; anywhere else (the Review and Agents pages, a doc, another project) in that page's side
 * panel, so a click never takes you away from where you were. The router matches without case.
 */
export const taskOpenFrom = (pathname: string, task: { readonly projectKey: string; readonly number: number }): TaskOpen => {
  const [projectKey, ...rest] = pathname.split("/").filter((part) => part !== "")
  if (projectKey?.toUpperCase() !== task.projectKey.toUpperCase()) return { type: "panel" }
  if (rest.length === 0 || (rest.length === 1 && (rest[0] === "issues" || /^\d+$/.test(rest[0]!)))) return { type: "board" }
  if (rest[0] === "milestones" && rest[1] !== undefined && (rest.length === 2 || (rest.length === 3 && /^\d+$/.test(rest[2]!)))) {
    return { type: "milestone", milestoneId: decodeURIComponent(rest[1]) }
  }
  return { type: "panel" }
}

/** The task a message asks the board's window to open: only a well-formed key, only from the board's own origin. */
export const openTaskFrom = (message: { readonly origin: string; readonly data: unknown }, origin: string): { projectKey: string; number: number } | null => {
  const data = message.data as Partial<OpenTaskMessage> | null
  if (message.origin !== origin || data?.type !== "cello:task" || typeof data.key !== "string") return null
  return parseTaskKey(data.key)
}


export interface OpenEnv {
  /** The board's origin; relative URLs resolve against it. */
  readonly origin: string
  /** The desktop app's bridge, when the board runs there. */
  readonly desktop: CelloDesktop | undefined
  /** Set when this page is a Cello page framed in the side panel: opens go to the board's window. */
  readonly parent?: ((target: OpenTarget) => void) | undefined
  /** Shows the item in this window's side panel. */
  readonly show: (item: ViewerItem) => void
  /** Shows an image in the image modal. */
  readonly modal: (item: ViewerItem) => void
}

/**
 * Opens `target` where `openRoute` says. Null when `target` isn't a web page: the caller lets the link
 * do what it would anyway. The board's window gets the target with an absolute URL.
 */
export const openTarget = (target: OpenTarget, env: OpenEnv): OpenRoute | null => {
  const item = toViewerItem(target, env.origin)
  if (!item) return null
  const route = openRoute(item, target, { desktop: env.desktop?.isDesktop === true, framed: env.parent !== undefined })
  switch (route) {
    case "parent":
      env.parent?.({ ...target, url: item.url })
      break
    case "desktop":
      env.desktop?.openPanel(item.url, item.title)
      break
    case "modal":
      env.modal(item)
      break
    case "panel":
      env.show(item)
      break
  }
  return route
}

/** Sites known to forbid framing (X-Frame-Options or CSP frame-ancestors): the viewer skips the iframe attempt. */
const REFUSES_FRAMING = ["claude.ai", "github.com", "google.com", "x.com", "twitter.com", "linkedin.com", "facebook.com", "instagram.com"]

export const refusesFraming = (url: string): boolean => {
  const host = URL.parse(url)?.hostname
  return host !== undefined && REFUSES_FRAMING.some((site) => host === site || host.endsWith(`.${site}`))
}

/** How long an external page gets to load before the viewer shows the fallback card. */
export const FRAME_TIMEOUT_MS = 8000

export type FrameState = "loading" | "shown" | "blocked"

export const nextFrameState = (state: FrameState, event: "load" | "error" | "timeout"): FrameState =>
  state !== "loading" ? state : event === "load" ? "shown" : "blocked"

/** A click the viewer takes over; ⌘/Ctrl/Shift/Alt and middle clicks do what the browser would. */
export const isPlainClick = (e: {
  readonly button: number
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly shiftKey: boolean
  readonly altKey: boolean
  readonly defaultPrevented: boolean
}): boolean => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.defaultPrevented

/** In px. It starts as wide as the task panel, so the board keeps its width when one replaces the other. */
export const VIEWER_WIDTH: WidthRule = { initial: 560, min: 320, minRest: 360, step: 32 }

export const WIDTH_KEY = "cello:viewer-width"
