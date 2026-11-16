// Which model wrote something (CEL-119), as people read it: Claude Code's transcript says
// `claude-sonnet-5-5`, the board and the CLI say "Sonnet 5.5". One place, so the web and the CLI agree.

const FAMILIES: Readonly<Record<string, string>> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", fable: "Fable" }

/** `claude-<family>-<major>[-<minor>][-<date>]`, today's form. A one- or two-digit minor; a date is 8 digits. */
const FAMILY_FIRST = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/

/** `claude-<major>[-<minor>]-<family>[-<date>]`, the older form (`claude-3-5-haiku-20241022`). */
const FAMILY_LAST = /^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)(?:-\d{8})?(?:\[[^\]]*\])?$/

const named = (family: string | undefined, major: string | undefined, minor: string | undefined): string | null => {
  const name = family === undefined ? undefined : FAMILIES[family]
  if (name === undefined || major === undefined) return null
  return `${name} ${minor === undefined ? major : `${major}.${minor}`}`
}

/** "Opus 5.5", "Sonnet 5.5", "Haiku 5.5", "Fable 5.2"; an id it doesn't know comes back as it is. */
export const modelName = (id: string): string => {
  const first = FAMILY_FIRST.exec(id)
  const last = first ? null : FAMILY_LAST.exec(id)
  return (first ? named(first[1], first[2], first[3]) : last ? named(last[3], last[1], last[2]) : null) ?? id
}

/** "Sonnet 5.5, medium", "Opus 5.5" without an effort; null without a model (nothing made up). */
export const modelLabel = (model: string | null | undefined, effort: string | null | undefined): string | null =>
  model ? (effort ? `${modelName(model)}, ${effort}` : modelName(model)) : null
