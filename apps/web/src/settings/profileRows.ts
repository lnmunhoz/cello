// What Settings' Testing section lists (CEL-89): every fixed field, set or not, then each e2e surface's
// fields, so Lucas sees what's missing and can fill it in.
import type { ProfileField, ProfileSource } from "@cello/contract/entities"
import { E2E_PARTS, type E2EPart, e2eField, e2eSurfaces, fieldLabel, PROFILE_FIELDS } from "@cello/shared/testingProfile"
import { relativeTime } from "../lib/format.ts"

const PART_NAMES: Record<E2EPart, string> = { run: "Run", videos: "Videos folder", screenshots: "Screenshots folder" }

export interface ProfileRow {
  readonly field: string
  /** What the field is called alone ("desktop e2e: run"), for its input's name. */
  readonly label: string
  /** What its row says: the same for a fixed field, the part alone ("Run") under its surface's heading. */
  readonly rowLabel: string
  /** The e2e surface it belongs to, or null for a fixed field. */
  readonly surface: string | null
  readonly value: string | null
  readonly source: ProfileSource | null
  readonly updatedAt: number | null
}

/** The fixed fields, then the surfaces the profile names and those `added` here (not saved until a field is). */
export const profileRows = (fields: ReadonlyArray<ProfileField>, added: ReadonlyArray<string>): ProfileRow[] => {
  const byName = new Map(fields.map((f) => [f.field, f]))
  const row = (field: string, surface: string | null): ProfileRow => {
    const set = byName.get(field)
    const part = e2eField(field)?.part
    return { field, label: fieldLabel(field), rowLabel: part ? PART_NAMES[part] : fieldLabel(field), surface, value: set?.value ?? null, source: set?.source ?? null, updatedAt: set?.updatedAt ?? null }
  }
  const surfaces = [...new Set([...e2eSurfaces(fields.map((f) => f.field)), ...added])]
  return [
    ...PROFILE_FIELDS.map((field) => row(field, null)),
    ...surfaces.flatMap((surface) => E2E_PARTS.map((part) => row(`e2e.${surface}.${part}`, surface))),
  ]
}

const SOURCE_NAMES: Record<ProfileSource, string> = { detected: "Detected", agent: "Agent", human: "You" }

/** "Detected · 2 min ago": where a value came from, and when it was last set or confirmed. */
export const sourceText = (field: { readonly source: ProfileSource; readonly updatedAt: number }, now = Date.now()): string =>
  `${SOURCE_NAMES[field.source]} · ${relativeTime(field.updatedAt, now)}`
