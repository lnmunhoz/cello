import { describe, expect, it } from "vitest"
import { HUMAN_FALLBACK_NAME, humanNameFrom } from "./humanName.ts"

describe("humanNameFrom", () => {
  it("uses git's user.name, trimmed", () => {
    expect(humanNameFrom("Ana Souza\n")).toBe("Ana Souza")
  })

  it("falls back to Human when git has no user name", () => {
    expect(humanNameFrom("")).toBe("Human")
    expect(humanNameFrom("  \n")).toBe("Human")
    expect(HUMAN_FALLBACK_NAME).toBe("Human")
  })
})
