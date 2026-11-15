// Reads that a newer CLI makes of an older server: fields added later are optional, so the response
// still decodes (CEL-74).
import * as Schema from "effect/Schema"
import { describe, expect, it } from "vitest"
import { Inbox } from "./views.ts"

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
})
