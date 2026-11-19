// `?embed=1`: a Cello page shown in a panel (the web viewer's iframe, the desktop app's native panel)
// asks for the app without its sidebar. Pure URL rules, shared by the web app and the desktop app.

/** The board's own pages get `embed=1`; files the server serves, and other sites, load as they are. */
export const embedUrl = (url: string, origin: string): string => {
  const parsed = new URL(url)
  if (parsed.origin !== new URL(origin).origin || parsed.pathname.startsWith("/attachments/")) return url
  parsed.searchParams.set("embed", "1")
  return parsed.href
}
