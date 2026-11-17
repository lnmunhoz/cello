// Reads that a newer CLI makes of an older server: fields added later are optional, so the response
// still decodes (CEL-74).
import * as Schema from "effect/Schema"
import { describe, expect, it } from "vitest"
import { Inbox, ProjectContext } from "./views.ts"

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
})
