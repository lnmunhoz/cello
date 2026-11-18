// Reads that a newer CLI makes of an older server: fields added later are optional, so the response
// still decodes (CEL-74).
import * as Schema from "effect/Schema"
import { describe, expect, it } from "vitest"
import { CelloEvent } from "./events.ts"
import { CelloRpcs } from "./rpcs.ts"
import { Activity, Inbox, ProjectContext, TaskDetail, TaskHistory } from "./views.ts"

// Events as the wire carries them: one this build knows, and one of a type a newer server added.
const envelope = { ts: 1_700_000_000_000, commandId: "c", actorId: "me", sessionId: null, workspaceId: "w1", projectId: "p1", schemaVersion: 1 }
const archived = { ...envelope, seq: 5, type: "task.archived", id: "t1", version: 3 }
const future = { ...envelope, seq: 6, type: "test.from-a-newer-build", note: "only a newer build reads this" }

describe("Inbox", () => {
  it("decodes an older server's inbox, without claimed or human", () => {
    const decoded = Schema.decodeUnknownSync(Inbox)({ session: null, items: [], earlier: [] })
    expect(decoded).toEqual({ session: null, items: [], earlier: [] })
    expect(decoded.claimed ?? []).toEqual([])
  })

  it("decodes the claims and the human's name when the server sends them", () => {
    expect(Schema.decodeUnknownSync(Inbox)({ session: null, items: [], earlier: [], claimed: ["CEL-1"], human: "Lucas" }))
      .toMatchObject({ claimed: ["CEL-1"], human: "Lucas" })
  })

  // CEL-143: an older `cello` failed the whole inbox on the new `approved` kind, after the server had
  // already marked it read. This build skips an item of a kind it doesn't know and reads the rest.
  it("skips an item of a kind a newer server added, and keeps the ones it knows", () => {
    const common = { taskId: "t1", taskKey: "CEL-1", taskTitle: "One", author: "Lucas", createdAt: 1, readAt: null }
    const approved = { ...common, id: "i1", kind: "approved", note: "Ship it" }
    const future = { ...common, id: "i2", kind: "test.from-a-newer-build", whatever: 3 }
    const decoded = Schema.decodeUnknownSync(Inbox)({ session: null, items: [future, approved], earlier: [future], claimed: [] })
    expect(decoded.items).toEqual([approved])
    expect(decoded.earlier).toEqual([])
    // What the server sends is unchanged: a known item encodes as it always did.
    expect(Schema.encodeSync(Inbox)({ session: null, items: [approved as never], earlier: [] })).toMatchObject({ items: [approved] })
  })
})

describe("ProjectContext", () => {
  it("skips an inbox item of a kind a newer server added", () => {
    expect(Schema.decodeUnknownSync(ProjectContext.fields.inbox)([{ id: "i2", kind: "test.from-a-newer-build" }])).toEqual([])
  })

  // CEL-150: `cello context` failed whole when one recent event had a type a newer server added (the
  // same class as CEL-131 and CEL-135). Recent activity and lost claims read each event leniently.
  const activities = [{ event: archived, taskKey: "CEL-1" }, { event: future, taskKey: "CEL-2" }]
  const expected = [
    { event: Schema.decodeUnknownSync(CelloEvent)(archived), taskKey: "CEL-1" },
    { event: { type: "unreadable", seq: 6, ts: 1_700_000_000_000, sentType: "test.from-a-newer-build" }, taskKey: "CEL-2" },
  ]

  it("reads a recent event of a type this build doesn't know as unreadable, and keeps the ones it knows", () => {
    expect(Schema.decodeUnknownSync(ProjectContext.fields.recent)(activities)).toEqual(expected)
  })

  it("does the same for the claims this session lost", () => {
    expect(Schema.decodeUnknownSync(ProjectContext.fields.lostClaims)(activities)).toEqual(expected)
  })

  it("sends a known activity exactly as before", () => {
    const event = Schema.decodeUnknownSync(CelloEvent)(archived)
    expect(Schema.encodeSync(Activity)({ event, taskKey: "CEL-1" })).toEqual({ event: Schema.encodeSync(CelloEvent)(event), taskKey: "CEL-1" })
  })
})

// CEL-135: a tab on an older web build failed the whole History section when the task's history held
// an event type a newer server added. A history decodes each event leniently, like the event stream (CEL-131).
describe("TaskHistory", () => {
  const read = Schema.decodeUnknownSync(TaskHistory)

  it("reads an event of a type this build doesn't know as unreadable, with its time, and keeps the ones it knows", () => {
    expect(read([archived, future])).toEqual([
      Schema.decodeUnknownSync(CelloEvent)(archived),
      { type: "unreadable", seq: 6, ts: 1_700_000_000_000, sentType: "test.from-a-newer-build" },
    ])
  })

  it("is what task.history returns and what task.get's history holds", () => {
    const success = CelloRpcs.requests.get("task.history")!.successSchema as typeof TaskHistory
    expect(Schema.decodeUnknownSync(success)([archived, future])).toEqual(read([archived, future]))
    expect(Schema.decodeUnknownSync(TaskDetail.fields.history)([archived, future])).toEqual(read([archived, future]))
  })

  it("sends a known event exactly as before, so older clients see no change on the wire", () => {
    const event = Schema.decodeUnknownSync(CelloEvent)(archived)
    expect(Schema.encodeSync(TaskHistory)([event])).toEqual([Schema.encodeSync(CelloEvent)(event)])
  })
})
