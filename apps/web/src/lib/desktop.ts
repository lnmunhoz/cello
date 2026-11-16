// The Cello desktop app (apps/desktop) shows the board in its own window, with a browser panel on the
// right that loads outside sites top-level, so it can show pages that refuse to be framed (claude.ai
// artifacts, `frame-ancestors 'self'`). Its preload exposes `window.celloDesktop`. Cello's own pages,
// text files, images and videos open in the board's own side panel (apps/web/src/viewer) either way;
// in a plain browser the bridge is missing and outside sites open there too.
import { parseTaskKey } from "@cello/shared/taskKey"
import { openImageModal } from "../viewer/imageModal.ts"
import { showInViewer } from "../viewer/store.ts"
import { openTarget, taskRoute, type OpenTarget, type OpenTaskMessage, type ViewerItem } from "../viewer/viewer.ts"

/**
 * The desktop app asks for a restart (CEL-75): its own build on disk changed since it started
 * (`updated`), or it runs from a build folder while /Applications has a copy (`elsewhere`). `key`
 * changes when the situation does.
 */
export type DesktopAppNotice =
  | { readonly kind: "updated"; readonly key: string }
  | { readonly kind: "elsewhere"; readonly key: string; readonly running: string }

/** What the desktop app's preload puts on `window.celloDesktop`. Only http(s) URLs are accepted. */
export interface CelloDesktop {
  readonly isDesktop: true
  openPanel(url: string, title?: string): void
  closePanel(): void
  /**
   * Calls `listener` with the app's current notice (null for none) now and on each change, until the
   * returned function is called. Missing in desktop builds before CEL-75, which a newer server's web
   * app can still be loaded into.
   */
  onAppNotice?(listener: (notice: DesktopAppNotice | null) => void): () => void
  /** Quits and starts the app again, from /Applications when it ran from another copy. */
  restartApp?(): void
}

declare global {
  interface Window {
    celloDesktop?: CelloDesktop
  }
}

/**
 * What asks the board's window to open something there: a Cello page framed in the side panel, and
 * the desktop app's preload for a `cello://open` link or a ⌘-click to a page on the board. The board
 * decides where it goes (`openRoute`).
 */
export interface OpenMessage {
  readonly type: "cello:open"
  readonly item: OpenTarget
}

/** The image modal, for an image link: just that image, the focus going back to what was clicked. */
const showInModal = (item: ViewerItem) => {
  const active = globalThis.document?.activeElement as HTMLElement | null | undefined
  openImageModal([{ url: item.url, title: item.title }], 0, active?.focus ? active : null)
}

/**
 * Opens `target` (its URL absolute, or relative to the board: `/attachments/<id>`, `/CEL/pages/notes`)
 * where viewer.ts's `openRoute` says: an image link in the image modal; a video, a text file or a Cello
 * page in the side panel beside the board; another site in the desktop app's native browser, or the
 * side panel in a browser. False when the URL isn't a web page, so a link's own behavior can take over.
 */
export const openInPanel = (target: OpenTarget): boolean => {
  const origin = window.location.origin
  const framed = window.self !== window.top
  const parent = framed ? (item: OpenTarget) => window.parent.postMessage({ type: "cello:open", item } satisfies OpenMessage, origin) : undefined
  return openTarget(target, { origin, desktop: window.celloDesktop, parent, show: showInViewer, modal: showInModal }) !== null
}

/**
 * Opens task `key` in the main window, where the board is (see `taskRoute`): with `navigate` on the
 * board, by asking the board's window from a page framed in the viewer. False from a page alone in a
 * panel: the click should follow the task's link, which the desktop app opens on the board.
 */
export const openTask = (key: string, navigate: (task: { projectKey: string; number: number }) => void): boolean => {
  const task = parseTaskKey(key)
  if (!task) return false
  switch (taskRoute({ self: window.self, top: window.top, search: window.location.search })) {
    case "router":
      navigate(task)
      return true
    case "parent":
      window.parent.postMessage({ type: "cello:task", key } satisfies OpenTaskMessage, window.location.origin)
      return true
    case "link":
      return false
  }
}
