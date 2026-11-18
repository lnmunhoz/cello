/**
 * `/settings?project=THAI` was where a project's labels, testing profile, waking and merge settings
 * lived (CEL-80); they're on the project's own Settings tab now (CEL-164), and the old address
 * redirects there (app/router.tsx).
 */
export interface SettingsSearch {
  readonly project?: string
}

export const parseSettingsSearch = (search: Record<string, unknown>): SettingsSearch => {
  const project = search["project"]
  return typeof project === "string" && project.trim() !== "" ? { project: project.trim().toUpperCase() } : {}
}
