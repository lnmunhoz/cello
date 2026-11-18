import { describe, expect, it } from "vitest"
import { parseSettingsSearch } from "./search.ts"

describe("parseSettingsSearch", () => {
  it("keeps ?project=KEY, upper-cased: the old address of a project's settings (CEL-164), which now redirects to its tab", () => {
    expect(parseSettingsSearch({ project: "thai" })).toEqual({ project: "THAI" })
    expect(parseSettingsSearch({ project: " CEL " })).toEqual({ project: "CEL" })
  })

  it("drops anything else", () => {
    expect(parseSettingsSearch({})).toEqual({})
    expect(parseSettingsSearch({ project: "  " })).toEqual({})
    expect(parseSettingsSearch({ project: 5 })).toEqual({})
  })
})
