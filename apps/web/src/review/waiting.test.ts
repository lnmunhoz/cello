import { describe, expect, it } from "vitest"
import { oldestKey, waitingLabel } from "./waiting.ts"

describe("waitingLabel: how long a row has waited on Lucas (CEL-190)", () => {
  const now = 1_000_000_000_000
  it("says it in minutes, hours or days, the way the rest of the app counts", () => {
    expect(waitingLabel(now - 20_000, now)).toBe("waiting <1 min")
    expect(waitingLabel(now - 5 * 60_000, now)).toBe("waiting 5 min")
    expect(waitingLabel(now - 59 * 60_000, now)).toBe("waiting 59 min")
    expect(waitingLabel(now - 3 * 3_600_000, now)).toBe("waiting 3 h")
    expect(waitingLabel(now - 2 * 86_400_000, now)).toBe("waiting 2 d")
    expect(waitingLabel(now - 45 * 86_400_000, now)).toBe("waiting 45 d")
  })

  it("a clock that is behind the server's doesn't make a negative wait", () => {
    expect(waitingLabel(now + 5 * 60_000, now)).toBe("waiting <1 min")
  })
})

describe("oldestKey: the row that has waited longest", () => {
  it("is the one with the earliest time", () => {
    expect(oldestKey([{ key: "CEL-3", since: 300 }, { key: "CEL-7", since: 100 }, { key: "THAI-2", since: 200 }])).toBe("CEL-7")
  })

  it("is none for a single row, since there is nothing to compare it with, and for none", () => {
    expect(oldestKey([{ key: "CEL-3", since: 300 }])).toBeNull()
    expect(oldestKey([])).toBeNull()
  })

  it("is none when rows tie for the oldest: nothing stands out", () => {
    expect(oldestKey([{ key: "CEL-3", since: 100 }, { key: "CEL-7", since: 100 }, { key: "THAI-2", since: 200 }])).toBeNull()
  })
})
