import { describe, expect, it } from "vitest"
import { formatBytes, formatDay, formatDue, relativeTime } from "./format.ts"

describe("format", () => {
  it("shows a day as a short month and day, with the year only when it differs", () => {
    const now = new Date(2026, 10, 14, 12).getTime()
    expect(formatDay(new Date(2026, 2, 31, 9).getTime(), now)).toBe("Mar 31")
    expect(formatDay(new Date(2025, 2, 31, 9).getTime(), now)).toBe("Mar 31, 2025")
  })

  it("shows a due date from its calendar day, whatever the time zone", () => {
    const now = new Date(2026, 10, 14, 12).getTime()
    expect(formatDue("2026-11-20", now)).toBe("Nov 20")
    expect(formatDue("2027-01-02", now)).toBe("Jan 2, 2027")
  })

  it("shows a file size in B, KB or MB", () => {
    expect(formatBytes(512)).toBe("512 B")
    expect(formatBytes(20_480)).toBe("20 KB")
    expect(formatBytes(3.4 * 1024 * 1024)).toBe("3.4 MB")
  })

  it("says how long ago something happened", () => {
    const now = 1_000_000_000_000
    expect(relativeTime(now - 20_000, now)).toBe("just now")
    expect(relativeTime(now - 5 * 60_000, now)).toBe("5 min ago")
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe("3 h ago")
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe("2 d ago")
  })
})
