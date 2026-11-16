// What the CLI prints about a project's testing profile (CEL-89): `cello profile`, its part of
// `cello context`, and `cello init`'s readiness report.
import type { ProfileField, TestingProfile } from "@cello/contract/entities"
import type { Detection } from "@cello/shared/detect"
import { missingFields } from "@cello/shared/testingProfile"
import { ago, andList, columns } from "./format.ts"

/** "install          bun install  (detected, 2m ago)"; the time only when `now` is given. */
export const profileLines = (fields: ReadonlyArray<Pick<ProfileField, "field" | "value" | "source" | "updatedAt">>, now?: number): string[] => {
  const width = Math.max(16, ...fields.map((f) => f.field.length + 1))
  return fields.map((f) => `${f.field.padEnd(width)} ${f.value}  (${f.source}${now === undefined ? "" : `, ${ago(f.updatedAt, now)}`})`)
}

const SET_HINT = "`cello profile set <field> \"<value>\"`"

/** The profile's part of `cello context`: its fields and what's missing, or how to start one. */
export const contextProfileLines = (profile: TestingProfile): string[] => {
  if (profile.fields.length === 0) return [`Testing   no profile yet: \`cello init\` detects one, or set fields with ${SET_HINT}`]
  const missing = missingFields(profile.fields)
  return [
    "Testing   how to test this repo and collect evidence; current best knowledge, so fix it with `cello profile set` when it's wrong",
    ...profileLines(profile.fields).map((l) => `  ${l}`),
    ...(missing.length ? [`  missing: ${missing.join(", ")}`] : []),
  ]
}

/** `cello init`'s readiness report: what it found, then a line per kind of evidence with what to do. */
export const readinessLines = (found: Detection): string[] => {
  const tools = [...found.stack, found.packageManager, found.tools.unit, ...found.tools.e2e].filter((t): t is string => t !== null)
  return [
    tools.length ? `Testing: detected ${tools.join(" · ")}` : "Testing: nothing detected (no test runner, e2e tool or app found)",
    ...found.readiness.flatMap((r) => {
      const [line] = columns([[r.state.padEnd(11), r.kind.padEnd(19), r.note]])
      return [`  ${line}`, ...(r.suggestion ? [`               → ${r.suggestion}`] : [])]
    }),
  ]
}

/** What `cello init` wrote into the profile from detection, and what it left. */
export const wroteLines = (done: { readonly written: ReadonlyArray<string>; readonly kept: ReadonlyArray<string> }): string[] => {
  if (done.written.length === 0 && done.kept.length === 0) {
    return [`Nothing to write to the testing profile yet. Set fields as the repo gets them: ${SET_HINT}.`]
  }
  const wrote = done.written.length ? `Wrote ${done.written.join(", ")} to the testing profile` : "Wrote nothing new to the testing profile"
  const kept = done.kept.length ? `; kept ${andList([...done.kept])}, which an agent or the human set` : ""
  return [`${wrote}${kept}. See \`cello profile\`.`]
}
