// `?embed=1`: a route shown inside a panel (an iframe beside the board, or the desktop app's browser
// panel) without the app's sidebar, breadcrumb and tabs. Routes that support it keep the param on
// their own links.
export const isEmbed = (search: Readonly<Record<string, unknown>>): boolean =>
  search["embed"] === 1 || search["embed"] === "1" || search["embed"] === true
