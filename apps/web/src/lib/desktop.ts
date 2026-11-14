// The Cello desktop app (apps/desktop) shows the board in its own window, with a browser panel on the
// right that loads pages top-level, so it can show pages that refuse to be framed (claude.ai
// artifacts, `frame-ancestors 'self'`). Its preload exposes `window.celloDesktop`. In a plain browser
// it's missing, and pages open in the board's own viewer panel (apps/web/src/viewer).
import { openTarget, type ViewerItem, type ViewerKind } from "../viewer/viewer.ts"
import { showInViewer } from "../viewer/store.ts"

/** What the desktop app's preload puts on `window.celloDesktop`. Only http(s) URLs are accepted. */
export interface CelloDesktop {
  readonly isDesktop: true
  openPanel(url: string, title?: string): void
  closePanel(): void
}

declare global {
  interface Window {
    celloDesktop?: CelloDesktop
  }
}

/** What a Cello page framed in the viewer posts to the board's window to open something there. */
export interface OpenMessage {
  readonly type: "cello:open"
  readonly item: ViewerItem
}

/**
 * Opens `url` (absolute, or relative to the board: `/attachments/<id>`, `/CEL/pages/notes`) beside the
 * board: in the desktop app's native panel, else in the web viewer panel. `kind` says a URL is an
 * image or a video when its extension doesn't. False when `url` isn't a web page, so a link's own
 * behavior can take over.
 */
export const openInPanel = (url: string, title?: string, kind?: Extract<ViewerKind, "image" | "video">): boolean => {
  const origin = window.location.origin
  const framed = window.self !== window.top
  const parent = framed
    ? (item: ViewerItem) => window.parent.postMessage({ type: "cello:open", item } satisfies OpenMessage, origin)
    : undefined
  return openTarget({ url, title, kind }, { origin, desktop: window.celloDesktop, parent, show: showInViewer }) !== null
}
