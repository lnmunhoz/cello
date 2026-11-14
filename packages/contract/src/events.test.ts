import { describe, expect, it } from "vitest"
import { decodeEvent, UnknownSchemaVersion } from "./events.ts"

const envelope = {
  seq: 7,
  ts: 1_700_000_000_000,
  commandId: "cmd-1",
  actorId: "actor-1",
  sessionId: null,
  workspaceId: "ws-1",
  projectId: "p-1",
}

describe("decodeEvent", () => {
  it("decodes a v1 event", () => {
    const event = decodeEvent({
      ...envelope,
      schemaVersion: 1,
      type: "task.updated",
      id: "t-1",
      before: { title: "Old" },
      after: { title: "New" },
      version: 2,
    })
    expect(event.type).toBe("task.updated")
    if (event.type === "task.updated") expect(event.after.title).toBe("New")
  })

  it("fails loudly on an unknown schema version", () => {
    expect(() => decodeEvent({ ...envelope, schemaVersion: 99, type: "task.archived", id: "t-1", version: 3 })).toThrow(
      UnknownSchemaVersion,
    )
  })

  it("rejects a payload that doesn't match its type", () => {
    expect(() => decodeEvent({ ...envelope, schemaVersion: 1, type: "task.archived" })).toThrow()
  })
})
