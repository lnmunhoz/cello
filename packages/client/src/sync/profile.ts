// A project's testing profile (CEL-89), loaded once in Settings and kept current by `profile.changed`.
import type { ProfileField, TestingProfile } from "@cello/contract/entities"
import type { CelloEvent } from "@cello/contract/events"
import { compareFields } from "@cello/shared/testingProfile"


/** The profile after `events`; the same object when none of them changes it. */
export const applyProfileEvents = (profile: TestingProfile, events: ReadonlyArray<CelloEvent>): TestingProfile => {
  let fields: ReadonlyArray<ProfileField> | null = null
  for (const e of events) {
    if (e.type !== "profile.changed" || e.project !== profile.projectId) continue
    let next: ProfileField[] = [...(fields ?? profile.fields)]
    for (const change of e.changes) {
      next = next.filter((f) => f.field !== change.field)
      if (change.after) next.push(change.after)
    }
    fields = next.sort((a, b) => compareFields(a.field, b.field))
  }
  return fields === null ? profile : { ...profile, fields }
}
