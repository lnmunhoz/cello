import type { DocumentSummary } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import type { BoardState } from "./applyEvents.ts"
import { documentBySlug, documentsOf, documentsOfTask } from "./documents.ts"

const doc = (id: string, updatedAt: number, extra: Partial<DocumentSummary> = {}): DocumentSummary => ({
  id, workspaceId: "w1", projectId: "p1", kind: "page", slug: id, title: id, summary: "", version: 1, tasks: [],
  createdByActorId: "a1", createdBySessionId: null, updatedByActorId: "a1", updatedBySessionId: null,
  updatedBy: { name: "Lucas", color: "#5E6AD2", session: null }, createdAt: 1, updatedAt, archivedAt: null, ...extra,
})

const state = {
  documents: {
    old: doc("old", 1, { kind: "doc" }),
    report: doc("report", 3, { tasks: [{ id: "t1", key: "CEL-1" }] }),
    spec: doc("spec", 2, { kind: "spec", tasks: [{ id: "t1", key: "CEL-1" }] }),
    gone: doc("gone", 9, { archivedAt: 9, tasks: [{ id: "t1", key: "CEL-1" }] }),
    elsewhere: doc("elsewhere", 5, { projectId: "p2" }),
  },
} as unknown as BoardState

describe("documents", () => {
  it("lists a project's documents newest first, by kind, without archived ones", () => {
    expect(documentsOf(state, "p1").map((d) => d.id)).toEqual(["report", "spec", "old"])
    expect(documentsOf(state, "p1", "spec").map((d) => d.id)).toEqual(["spec"])
    expect(documentsOf(state, "p2").map((d) => d.id)).toEqual(["elsewhere"])
  })

  it("finds one by slug, archived included, and the ones a task links to", () => {
    expect(documentBySlug(state, "p1", "gone")?.id).toBe("gone")
    expect(documentBySlug(state, "p2", "report")).toBeUndefined()
    expect(documentsOfTask(state, "t1").map((d) => d.id)).toEqual(["report", "spec"])
  })
})
