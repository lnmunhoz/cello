import { describe, expect, it } from "vitest"
import { sessionLabel, shortSession } from "./session.ts"

describe("shortSession", () => {
  it("keeps the first 8 characters of a host session id", () => {
    expect(shortSession("3fd1f460-9c2e-4b1a-8d57-0f6a1c2b3d4e")).toBe("3fd1f460")
    expect(shortSession("abc")).toBe("abc")
  })
})

describe("sessionLabel", () => {
  it("names a session as its client and short id", () => {
    expect(sessionLabel("Claude Code", "3fd1f460-9c2e-4b1a-8d57-0f6a1c2b3d4e")).toBe("Claude Code session 3fd1f460")
  })

  it("leaves the id out when the session has none", () => {
    expect(sessionLabel("Claude Code", null)).toBe("Claude Code session")
  })
})
