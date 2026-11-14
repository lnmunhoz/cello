// What the board and the browser panel may open, and where. Pure, so the rules are tested once here
// and main-process code only maps a decision to an Electron call.

/** The panel shows web pages only: http(s), normalized. Anything else (javascript:, file:, data:…) is null. */
export const panelUrl = (raw: string): string | null => {
  const url = URL.parse(raw.trim())
  return url && (url.protocol === "http:" || url.protocol === "https:") ? url.href : null
}

const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i
const LOCAL_HOST = /^(localhost|127(\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i

/** What was typed in the panel's address field, as a URL: local hosts get http, other hosts https. */
export const addressToUrl = (input: string): string | null => {
  const text = input.trim()
  if (text === "" || /\s/.test(text)) return null
  if (HAS_SCHEME.test(text)) return panelUrl(text)
  if (LOCAL_HOST.test(text)) return panelUrl(`http://${text}`)
  return text.includes(".") ? panelUrl(`https://${text}`) : null
}

const isMail = (url: string) => url.trim().toLowerCase().startsWith("mailto:")

export type OpenAction = "panel" | "external" | "deny"

/** A board link that wants a new window (target=_blank, window.open): web pages go to the panel. */
export const boardWindowOpenAction = (url: string): OpenAction =>
  panelUrl(url) ? "panel" : isMail(url) ? "external" : "deny"

/** The board stays on its own origin; a link to any other page opens in the panel instead. */
export const boardNavigationAction = (url: string, boardOrigin: string): "allow" | OpenAction => {
  const target = URL.parse(url)
  if (target && target.origin === new URL(boardOrigin).origin) return "allow"
  return boardWindowOpenAction(url)
}

/**
 * A panel page that wants a new window stays in the panel, except a scripted popup
 * (`window.open` with features), which sign-in flows (OAuth) need with a live opener.
 */
export const panelWindowOpenAction = (details: { readonly url: string; readonly disposition: string }): "popup" | OpenAction => {
  if (!panelUrl(details.url)) return isMail(details.url) ? "external" : "deny"
  return details.disposition === "new-window" ? "popup" : "panel"
}

/** The panel page may go to any web page; mail links go to the mail app. */
export const panelNavigationAction = (url: string): "allow" | "external" | "deny" =>
  panelUrl(url) || url === "about:blank" ? "allow" : isMail(url) ? "external" : "deny"

/** The toolbar's title: the one Cello gave while still on that page, else the page's own, else the URL. */
export const panelTitle = (state: {
  readonly url: string
  readonly pageTitle: string
  readonly opened: { readonly url: string; readonly title: string } | null
}): string => {
  if (state.opened && state.opened.title && state.opened.url === state.url) return state.opened.title
  return state.pageTitle || state.url
}
