// The viewer side panel's rules: what a URL is (image, video, Cello page, external site), where an
// "open" goes (the desktop app's native panel, the board's viewer, or this page's own), and its width.
// Pure, so the rules are tested once here; the components only map a decision to the DOM.
import { embedUrl } from "@cello/shared/embed"
import { shortUrl } from "@cello/shared/linkify"
import { parseTaskKey } from "@cello/shared/taskKey"
import type { CelloDesktop } from "../lib/desktop.ts"

/** image and video: shown as such. page: the board's own origin, in an iframe. external: an iframe attempt. */
export type ViewerKind = "image" | "video" | "page" | "external"

export interface ViewerItem {
  /** Absolute http(s). */
  readonly url: string
  readonly title: string
  readonly kind: ViewerKind
}

/** What a caller asks to open: a URL (absolute, or relative to the board), and what it knows about it. */
export interface OpenTarget {
  readonly url: string
  readonly title?: string | undefined
  /** Set for evidence known to be an image or a video, whatever its URL looks like. */
  readonly kind?: "image" | "video" | undefined
}

const IMAGE = /\.(png|jpe?g|gif|webp|avif|svg)$/i
const VIDEO = /\.(mp4|webm|mov|m4v|ogv)$/i

const resolve = (url: string, origin: string): URL | null => {
  if (url.trim() === "" || url.startsWith("#")) return null
  const parsed = URL.parse(url.trim(), origin)
  return parsed && (parsed.protocol === "http:" || parsed.protocol === "https:") ? parsed : null
}

/** Null for anything that isn't a web page (javascript:, file:, mailto:, a bare #hash…). */
export const toViewerItem = (target: OpenTarget, origin: string): ViewerItem | null => {
  const url = resolve(target.url, origin)
  if (!url) return null
  const kind: ViewerKind =
    target.kind ??
    (IMAGE.test(url.pathname) ? "image" : VIDEO.test(url.pathname) ? "video" : url.origin === new URL(origin).origin ? "page" : "external")
  return { url: url.href, title: target.title?.trim() || shortUrl(url.href), kind }
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
  /** Set when this page is a Cello page framed in the board's viewer: opens go to the board's window. */
  readonly parent?: ((item: ViewerItem) => void) | undefined
  /** Shows the item in this page's viewer panel. */
  readonly show: (item: ViewerItem) => void
}

export type OpenRoute = "desktop" | "parent" | "viewer"

/**
 * Where an "open" goes: the desktop app's native browser panel when its bridge is there (it shows any
 * site, claude.ai included), else the board's viewer panel. Null when `target` isn't a web page:
 * the caller lets the link do what it would anyway.
 */
export const openTarget = (target: OpenTarget, env: OpenEnv): OpenRoute | null => {
  const item = toViewerItem(target, env.origin)
  if (!item) return null
  if (env.desktop?.isDesktop) {
    env.desktop.openPanel(embedUrl(item.url, env.origin), item.title)
    return "desktop"
  }
  if (env.parent) {
    env.parent(item)
    return "parent"
  }
  env.show(item)
  return "viewer"
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
export const VIEWER_WIDTH = { initial: 560, min: 320, minPage: 360, step: 32 } as const

export const WIDTH_KEY = "cello:viewer-width"

/** The width saved in localStorage, or the initial one. */
export const readWidth = (stored: string | null): number => {
  const width = Number(stored)
  return stored !== null && Number.isFinite(width) && width > 0 ? Math.round(width) : VIEWER_WIDTH.initial
}

/** Between the minimum and what leaves `minPage` for the page beside it (the minimum wins in a narrow window). */
export const clampWidth = (width: number, container: number): number =>
  Math.round(Math.max(VIEWER_WIDTH.min, Math.min(width, container - VIEWER_WIDTH.minPage)))

/** The width while its left edge is dragged from `start.x` to `x`. */
export const dragWidth = (start: { readonly width: number; readonly x: number }, x: number, container: number): number =>
  clampWidth(start.width + start.x - x, container)
