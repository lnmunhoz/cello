import { describe, expect, it } from "vitest"
import { ACTIVE_MS, agoShort, presenceOf, presenceWords } from "./presence.ts"

const MIN = 60_000
const now = 1_800_000_000_000

describe("presenceOf", () => {
  it("is active while the session checked in within the last few minutes", () => {
    expect(presenceOf({ lastSeenAt: now - 10_000, endedAt: null }, now)).toBe("active")
    expect(presenceOf({ lastSeenAt: now - ACTIVE_MS, endedAt: null }, now)).toBe("active")
  })

  it("is idle once it has been quiet longer, and ended once its process is gone", () => {
    expect(presenceOf({ lastSeenAt: now - ACTIVE_MS - 1, endedAt: null }, now)).toBe("idle")
    expect(presenceOf({ lastSeenAt: now - 10_000, endedAt: now - 5_000 }, now)).toBe("ended")
  })

  it("is active while a run Cello woke goes (CEL-136), before it checks in and however long it runs", () => {
    const run = { startedAt: now - 20 * MIN, endedAt: null }
    expect(presenceOf({ lastSeenAt: now - 60 * MIN, endedAt: now - 30 * MIN, lastRun: run }, now)).toBe("active")
    // Once the run ended, its presence is the session's own again.
    expect(presenceOf({ lastSeenAt: now - 60 * MIN, endedAt: now - 30 * MIN, lastRun: { ...run, endedAt: now - MIN } }, now)).toBe("ended")
  })
})

describe("presenceWords", () => {
  it("says active now, seen … ago, or ended", () => {
    expect(presenceWords({ lastSeenAt: now - 30_000, endedAt: null }, now)).toBe("active now")
    expect(presenceWords({ lastSeenAt: now - 2 * 60 * MIN, endedAt: null }, now)).toBe("seen 2h ago")
    expect(presenceWords({ lastSeenAt: now - 2 * 60 * MIN, endedAt: now - MIN }, now)).toBe("ended")
  })
})

describe("agoShort", () => {
  it("counts minutes, hours, then days", () => {
    expect(agoShort(now - 20_000, now)).toBe("just now")
    expect(agoShort(now - 4 * MIN, now)).toBe("4m ago")
    expect(agoShort(now - 3 * 60 * MIN, now)).toBe("3h ago")
    expect(agoShort(now - 50 * 60 * MIN, now)).toBe("2d ago")
    expect(agoShort(now + 5_000, now)).toBe("just now")
  })
})
