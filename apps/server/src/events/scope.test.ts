import type { CelloEvent } from "@cello/contract/events"
import { describe, expect, it } from "vitest"
import { inScope } from "./scope.ts"

const event = (workspaceId: string, projectId: string | null) =>
  ({ workspaceId, projectId, type: "label.archived", id: "l1" }) as unknown as CelloEvent

describe("inScope", () => {
  it("a workspace scope gets every event in that workspace and nothing else", () => {
    const scope = { workspaceId: "w1", projectId: null }
    expect(inScope(event("w1", null), scope)).toBe(true)
    expect(inScope(event("w1", "p1"), scope)).toBe(true)
    expect(inScope(event("w2", null), scope)).toBe(false)
  })

  it("a project scope gets its project's events plus workspace-level ones", () => {
    const scope = { workspaceId: "w1", projectId: "p1" }
    expect(inScope(event("w1", "p1"), scope)).toBe(true)
    expect(inScope(event("w1", null), scope)).toBe(true)
    expect(inScope(event("w1", "p2"), scope)).toBe(false)
    expect(inScope(event("w2", null), scope)).toBe(false)
  })
})
