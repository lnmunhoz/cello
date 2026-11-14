// The Cello desktop app (apps/desktop) shows the board in its own window, with a browser panel on the
// right that loads pages top-level, so it can show pages that refuse to be framed (claude.ai
// artifacts, `frame-ancestors 'self'`). Its preload exposes `window.celloDesktop`; in a plain browser
// it's missing and pages open in a new tab.

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

/** Opens `url` in the desktop app's side panel, or in a new browser tab outside the app. */
export const openInPanel = (url: string, title?: string): void => {
  const desktop = window.celloDesktop
  if (desktop?.isDesktop) desktop.openPanel(url, title)
  else window.open(url, "_blank", "noopener,noreferrer")
}
