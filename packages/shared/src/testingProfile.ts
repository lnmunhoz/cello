// A project's testing profile (CEL-89): how to install, test, start the app and collect evidence in its
// repo. It's current best knowledge, not a fixed config: `cello init` drafts it from what it detects,
// agents fix it when a command in it fails or the repo changes, and Lucas edits it in Settings. Each
// field is one flat key, so a new one is a new name here, not a migration.

/** Who set a field last: `cello init`'s detection, an agent session, or the human. */
export const PROFILE_SOURCES = ["detected", "agent", "human"] as const
export type ProfileSource = (typeof PROFILE_SOURCES)[number]

/** Fields every project has, in the order screens list them. */
export const PROFILE_FIELDS = [
  "install",
  "unit",
  "typecheck",
  "ui.runsIn",
  "app.start",
  "app.url",
  "evidence.ui",
  "evidence.cli",
  "review.env",
  "never.touch",
] as const
export type FixedProfileField = (typeof PROFILE_FIELDS)[number]

/** One e2e entry per surface (web, desktop, mobile…): how to run it and where its videos and screenshots land. */
export const E2E_PARTS = ["run", "videos", "screenshots"] as const
export type E2EPart = (typeof E2E_PARTS)[number]

const E2E_FIELD = /^e2e\.([a-z][a-z0-9-]{0,29})\.(run|videos|screenshots)$/

/** Where UI tests run. Unset means local (headless), the default. */
export const UI_RUNS_IN = ["local", "docker"] as const
export const DEFAULT_UI_RUNS_IN = "local"

const MAX_VALUE = 1000

const LABELS: Record<FixedProfileField, string> = {
  "install": "Install",
  "unit": "Unit tests",
  "typecheck": "Typecheck",
  "ui.runsIn": "UI tests run",
  "app.start": "Start the app",
  "app.url": "App ready at",
  "evidence.ui": "Evidence for UI work",
  "evidence.cli": "Evidence for CLI work",
  "review.env": "Review recording env",
  "never.touch": "Never touch",
}

const PART_LABELS: Record<E2EPart, string> = { run: "run", videos: "videos folder", screenshots: "screenshots folder" }

/** A field's surface and part when it's an e2e one. */
export const e2eField = (field: string): { readonly surface: string; readonly part: E2EPart } | null => {
  const match = E2E_FIELD.exec(field)
  return match ? { surface: match[1]!, part: match[2] as E2EPart } : null
}

/** Why `field` isn't a profile field, or null when it is. */
export const profileFieldProblem = (field: string): string | null =>
  (PROFILE_FIELDS as ReadonlyArray<string>).includes(field) || e2eField(field)
    ? null
    : `unknown field "${field}". Fields: ${PROFILE_FIELDS.join(", ")}, and ${E2E_PARTS.map((p) => `e2e.<surface>.${p}`).join(", ")} (surface: web, desktop, …)`

/** A value as stored (trimmed; ui.runsIn lower-cased), or why it can't be. Empty is refused: unsetting removes a field. */
export const checkProfileValue = (field: string, raw: string): { readonly value: string } | { readonly problem: string } => {
  const value = raw.trim()
  if (value === "") return { problem: `the value of ${field} can't be empty; unset it instead` }
  if (value.length > MAX_VALUE) return { problem: `the value of ${field} is longer than ${MAX_VALUE} characters` }
  if (field === "ui.runsIn") {
    const lower = value.toLowerCase()
    return (UI_RUNS_IN as ReadonlyArray<string>).includes(lower) ? { value: lower } : { problem: `the value of ui.runsIn must be "local" or "docker", not "${value}"` }
  }
  return { value }
}

/** What screens call a field. */
export const fieldLabel = (field: string): string => {
  const e2e = e2eField(field)
  if (e2e) return `${e2e.surface} e2e: ${PART_LABELS[e2e.part]}`
  return LABELS[field as FixedProfileField] ?? field
}

/** The e2e surfaces a profile names, in the order their first field appears. */
export const e2eSurfaces = (fields: ReadonlyArray<string>): string[] => [
  ...new Set(fields.flatMap((f) => {
    const e2e = e2eField(f)
    return e2e ? [e2e.surface] : []
  })),
]

/** Fields in the order screens list them: the fixed ones, then each surface's e2e fields. */
export const fieldOrder = (field: string): number => {
  const fixed = (PROFILE_FIELDS as ReadonlyArray<string>).indexOf(field)
  if (fixed !== -1) return fixed
  const e2e = e2eField(field)
  return e2e ? 100 + E2E_PARTS.indexOf(e2e.part) : 1000
}

/** Fields a builder needs that nobody has set yet. ui.runsIn defaults to local; review.env and never.touch are optional. */
export const missingFields = (fields: ReadonlyArray<{ readonly field: string }>): string[] => {
  const set = new Set(fields.map((f) => f.field))
  const core = ["install", "unit", "typecheck", "app.start", "app.url"].filter((f) => !set.has(f))
  const e2e = fields.some((f) => e2eField(f.field)?.part === "run") ? [] : ["e2e.<surface>.run"]
  return [...core, ...e2e, ...["evidence.ui", "evidence.cli"].filter((f) => !set.has(f))]
}
