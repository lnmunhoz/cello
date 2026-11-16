// A project's wake settings (CEL-92), loaded once in Settings and kept current by `wake.settings_changed`.
import type { WakeSettings } from "@cello/contract/entities"
import type { CelloEvent } from "@cello/contract/events"

/** The settings after `events`; the same object when none of them is about this project. */
export const applyWakeSettingsEvents = (settings: WakeSettings, events: ReadonlyArray<CelloEvent>): WakeSettings => {
  let next = settings
  for (const e of events) {
    if (e.type !== "wake.settings_changed" || e.project !== settings.projectId) continue
    next = { ...next, ...e.after }
  }
  return next
}
