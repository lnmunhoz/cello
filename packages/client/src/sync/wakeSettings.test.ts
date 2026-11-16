import type { WakeSettings } from "@cello/contract/entities"
import type { CelloEvent } from "@cello/contract/events"
import { describe, expect, it } from "vitest"
import { applyWakeSettingsEvents } from "./wakeSettings.ts"

const settings: WakeSettings = { projectId: "p1", enabled: false, capPerHour: 3, apiKeySet: false, agents: [] }
const changed = (project: string, after: { enabled?: boolean; capPerHour?: number }): CelloEvent =>
  ({ seq: 2, ts: 2, commandId: "c", actorId: "me", sessionId: null, workspaceId: "w", projectId: project, schemaVersion: 1, type: "wake.settings_changed", project, before: {}, after }) as CelloEvent

describe("applyWakeSettingsEvents (CEL-92)", () => {
  it("follows the project's own changes, and is the same object when none is about it", () => {
    expect(applyWakeSettingsEvents(settings, [changed("p1", { enabled: true }), changed("p1", { capPerHour: 5 })])).toEqual({ ...settings, enabled: true, capPerHour: 5 })
    expect(applyWakeSettingsEvents(settings, [changed("p2", { enabled: true })])).toBe(settings)
  })
})
