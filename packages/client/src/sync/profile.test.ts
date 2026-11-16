import type { ProfileField, TestingProfile } from "@cello/contract/entities"
import type { CelloEvent } from "@cello/contract/events"
import { describe, expect, it } from "vitest"
import { applyProfileEvents } from "./profile.ts"

const field = (name: string, value: string, source: ProfileField["source"] = "detected"): ProfileField =>
  ({ field: name, value, source, updatedAt: 1, actorId: "a", sessionId: null })

const changed = (project: string, changes: Array<{ field: string; before: ProfileField | null; after: ProfileField | null }>, seq = 2): CelloEvent =>
  ({ seq, ts: 2, commandId: "c", actorId: "a", sessionId: null, workspaceId: "w", projectId: project, schemaVersion: 1, type: "profile.changed", project, changes }) as CelloEvent

describe("a testing profile kept current by events (CEL-89)", () => {
  const profile: TestingProfile = { projectId: "p1", fields: [field("install", "bun install"), field("e2e.web.run", "bun run test:e2e")] }

  it("sets, replaces and unsets fields, keeping display order", () => {
    const next = applyProfileEvents(profile, [
      changed("p1", [
        { field: "unit", before: null, after: field("unit", "bun run test", "human") },
        { field: "install", before: field("install", "bun install"), after: field("install", "bun i", "agent") },
        { field: "e2e.web.run", before: field("e2e.web.run", "x"), after: null },
      ]),
    ])
    expect(next.fields.map((f) => [f.field, f.value, f.source])).toEqual([["install", "bun i", "agent"], ["unit", "bun run test", "human"]])
  })

  it("another project's changes and other events leave it as it was (the same object)", () => {
    const other = { ...changed("p2", [{ field: "unit", before: null, after: field("unit", "x") }]) }
    const unrelated = { seq: 3, type: "project.archived", id: "p1" } as unknown as CelloEvent
    expect(applyProfileEvents(profile, [other, unrelated])).toBe(profile)
  })
})
