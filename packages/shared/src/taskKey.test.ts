import { describe, expect, it } from "vitest"
import { formatTaskKey, isValidProjectKey, parseTaskKey, suggestProjectKey } from "./taskKey.ts"

describe("project keys", () => {
  it.each([
    ["THAI", true],
    ["CEL", true],
    ["A1", true],
    ["X", false],
    ["thai", false],
    ["1ABC", false],
    ["TOOLONGKEY1", false],
    ["TH-AI", false],
  ])("%s valid: %s", (key, valid) => {
    expect(isValidProjectKey(key)).toBe(valid)
  })

  it("suggests a key from a project name", () => {
    expect(suggestProjectKey("ThaiLookup")).toBe("THAI")
    expect(suggestProjectKey("cello")).toBe("CEL")
    expect(suggestProjectKey("Rent a Bus")).toBe("RAB")
    expect(isValidProjectKey(suggestProjectKey("9 lives"))).toBe(true)
  })
})

describe("task keys", () => {
  it("formats and parses", () => {
    expect(formatTaskKey("THAI", 12)).toBe("THAI-12")
    expect(parseTaskKey("THAI-12")).toEqual({ projectKey: "THAI", number: 12 })
    expect(parseTaskKey("thai-12")).toEqual({ projectKey: "THAI", number: 12 })
  })

  it("rejects malformed keys", () => {
    for (const bad of ["THAI", "THAI-", "THAI-0", "THAI-1.5", "-12", "TH AI-1"]) {
      expect(parseTaskKey(bad)).toBeNull()
    }
  })
})
