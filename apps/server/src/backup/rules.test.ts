// Folder names, which backups retention removes, and whether an asset file is linked or copied.
import { describe, expect, it } from "@effect/vitest"
import { backupId, freeId, isBackupId, KEEP, linkOrCopy, toPrune } from "./rules.ts"

describe("backup folder names", () => {
  it("are the local date and time, zero-padded: YYYYMMDD-HHMMSS", () => {
    expect(backupId(new Date(2026, 10, 15, 11, 14, 31))).toBe("20261115-111431")
    expect(backupId(new Date(2026, 0, 5, 7, 8, 9))).toBe("20260105-070809")
  })

  it("only that shape, with an optional -n for a second backup in the same second, is one of ours", () => {
    for (const name of ["20261115-111431", "20261115-111431-2", "20261115-111431-12"]) expect(isBackupId(name), name).toBe(true)
    for (const name of [
      "full-20261115-111431", // a hand-made full backup
      "20261115-111431.db", // a hand-made db-only one
      "cello-20261115.db",
      "20261115-1114",
      "20261115-111431-",
      "20261115-111431-0",
      ".partial-20261115-111431",
      "../20261115-111431",
    ]) expect(isBackupId(name), name).toBe(false)
  })

  it("a name already taken gets -2, -3, …", () => {
    expect(freeId("20261115-111431", () => false)).toBe("20261115-111431")
    const taken = new Set(["20261115-111431", "20261115-111431-2"])
    expect(freeId("20261115-111431", (id) => taken.has(id))).toBe("20261115-111431-3")
  })
})

describe("retention", () => {
  const day = 86_400_000
  const backups = (kind: "auto" | "manual" | "safety", count: number, from = 0) =>
    Array.from({ length: count }, (_, i) => ({ id: `${kind}-${i}`, kind, createdAt: from + i * day }))

  it("keeps the newest 14 auto backups and removes the older ones", () => {
    expect(KEEP).toBe(14)
    expect(toPrune(backups("auto", 14))).toEqual([])
    expect([...toPrune(backups("auto", 20))].sort()).toEqual(["auto-0", "auto-1", "auto-2", "auto-3", "auto-4", "auto-5"])
  })

  it("counts manual backups separately, so a burst of them never pushes out the daily history", () => {
    const daily = backups("auto", 14)
    const burst = backups("manual", 16, 13 * day + 1)
    expect([...toPrune([...daily, ...burst])].sort()).toEqual(["manual-0", "manual-1"])
  })

  it("counts safety backups (the undo for a restore) apart too, so manual backups never push one out", () => {
    const undo = backups("safety", 1)
    const manual = backups("manual", 30, day)
    expect(toPrune([...undo, ...manual])).not.toContain("safety-0")
    expect([...toPrune([...backups("safety", 15), ...manual])].filter((id) => id.startsWith("safety"))).toEqual(["safety-0"])
  })

  it("never removes a protected backup, such as the one being restored", () => {
    expect(toPrune(backups("safety", 15), { protect: ["safety-0"] })).toEqual([])
    expect(toPrune(backups("auto", 16), { protect: ["auto-0"] })).toEqual(["auto-1"])
  })

  it("orders by when a backup was taken, not by its name or position", () => {
    const shuffled = [
      { id: "b", kind: "auto" as const, createdAt: 3 },
      { id: "a", kind: "auto" as const, createdAt: 1 },
      { id: "c", kind: "auto" as const, createdAt: 2 },
    ]
    expect(toPrune(shuffled, { keep: 2 })).toEqual(["a"])
  })
})

describe("linking or copying an asset file", () => {
  const file = { size: 1_000, mtimeMs: 1_794_717_269_645.1597 }
  const never = () => {
    throw new Error("content compared without need")
  }

  it("a file the previous backup doesn't have is copied", () => {
    expect(linkOrCopy(file, null, never)).toBe("copy")
  })

  it("the same size and modification time (to the millisecond) is the same file: linked without reading it", () => {
    expect(linkOrCopy(file, { size: 1_000, mtimeMs: 1_794_717_269_645 }, never)).toBe("link")
  })

  it("a different size is a changed file: copied without reading it", () => {
    expect(linkOrCopy(file, { size: 999, mtimeMs: file.mtimeMs }, never)).toBe("copy")
  })

  it("the same size with another time is compared by content (sha256): linked when equal, copied when not", () => {
    const touched = { size: 1_000, mtimeMs: file.mtimeMs + 60_000 }
    expect(linkOrCopy(file, touched, () => true)).toBe("link")
    expect(linkOrCopy(file, touched, () => false)).toBe("copy")
  })
})
