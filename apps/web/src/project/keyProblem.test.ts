import { describe, expect, it } from "vitest"
import { keyProblem } from "./keyProblem.ts"

describe("keyProblem", () => {
  const taken = new Map([["THAI", "ThaiLookup"]])
  it("names the project that already uses a key", () => {
    expect(keyProblem("THAI", taken)).toBe("THAI is used by ThaiLookup")
  })
  it("checks the pattern and accepts a free key", () => {
    expect(keyProblem("T", taken)).toMatch(/2–10/)
    expect(keyProblem("CEL", taken)).toBeNull()
    expect(keyProblem("", taken)).toBe("Pick a key")
  })
})
