import { describe, expect, it } from "vitest"
import { formatTaskKey, freeProjectKey, isValidProjectKey, parseTaskKey, parseTaskPath, reservedKeyProblem, suggestProjectKey, taskKeysIn, taskPath } from "./taskKey.ts"

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

  it("a free key: the suggestion, else a longer piece of the name, else the suggestion with a number", () => {
    const taken = (...keys: string[]) => (key: string) => keys.includes(key)
    expect(freeProjectKey("cello", taken())).toBe("CEL")
    expect(freeProjectKey("cello", taken("CEL"))).toBe("CELL")
    expect(freeProjectKey("cello", taken("CEL", "CELL", "CELLO"))).toBe("CEL2")
    expect(freeProjectKey("cello", taken("CEL", "CELL", "CELLO", "CEL2"))).toBe("CEL3")
    expect(freeProjectKey("ThaiLookup", taken("THAI"))).toBe("THAIL")
    expect(freeProjectKey("my-app", taken("MA"))).toBe("MYA")
    const tenLetters = "ABCDEFGHIJ"
    const all = [...Array(11).keys()].map((n) => tenLetters.slice(0, n))
    expect(freeProjectKey(tenLetters, taken(...all, "ABCD"))).toBe("ABCD2")
    for (const name of ["9 lives", "", "--", "Über café"]) expect(isValidProjectKey(freeProjectKey(name, taken()))).toBe(true)
  })

  it("never a word the board's own pages use at the top level (/builds, /settings, /review…), which would hide the project (CEL-50)", () => {
    expect(reservedKeyProblem("BUILDS")).toBe("can't be BUILDS, the address of Cello's Builds page (/builds)")
    for (const key of ["SETTINGS", "REVIEW", "RELEASES", "ASSETS", "ICONS", "ATTACHMENTS", "RPC"]) expect(reservedKeyProblem(key)).not.toBeNull()
    // The Agents page (CEL-65).
    expect(reservedKeyProblem("agents")).toBe("can't be AGENTS, the address of Cello's Agents page (/agents)")
    expect(reservedKeyProblem("CEL")).toBeNull()
    expect(reservedKeyProblem("BUILD")).toBeNull()
    // Without a key given, one made from the name skips them.
    expect(freeProjectKey("Review", (k) => k === "REVI" || k === "REVIE")).toBe("REVI2")
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

describe("task paths", () => {
  it("the board's path for a task", () => {
    expect(taskPath("CEL", 3)).toBe("/CEL/3")
  })

  it("reads a task's path back, and no other path", () => {
    expect(parseTaskPath("/CEL/3")).toEqual({ projectKey: "CEL", number: 3 })
    expect(parseTaskPath("/thai/12")).toEqual({ projectKey: "THAI", number: 12 })
    for (const bad of ["/CEL/issues", "/CEL/pages/notes", "/CEL/docs", "/review", "/", "/CEL/0", "/CEL/3/x", "/C/3", "CEL/3", "/attachments/3"]) {
      expect(parseTaskPath(bad)).toBeNull()
    }
  })
})

describe("task keys in text (CEL-55: the task an agent's launch names)", () => {
  it("finds each key once, in the order they appear, upper case only and on word edges", () => {
    expect(taskKeysIn("You are a cello-builder building CEL-55. CEL-35 did presence; see CEL-55 and THAI-12.")).toEqual(["CEL-55", "CEL-35", "THAI-12"])
    expect(taskKeysIn("CEL-55 which agent is on each card")).toEqual(["CEL-55"])
    expect(taskKeysIn("cel-55, XCEL-0, CEL-055x, A-1, (WRK-7)")).toEqual(["WRK-7"])
    expect(taskKeysIn("")).toEqual([])
  })
})
