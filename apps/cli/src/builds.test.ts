// `cello builds` (CEL-50): each build on one line, newest first, the running one marked, its changes under it.
import type { BuildRecord } from "@cello/contract/build"
import { describe, expect, it } from "vitest"
import { buildsText } from "./builds.ts"

const at = (day: number, hours: number, minutes: number) => new Date(2026, 10, day, hours, minutes).getTime()

const build = (number: number, commit: string, startedAt: number, liveUntil: number | null, changes: ReadonlyArray<string>): BuildRecord => ({
  id: `0.2.0+${commit}.${number}`,
  number,
  version: "0.2.0",
  commit,
  webBuiltAt: startedAt - 60_000,
  startedAt,
  lastStartedAt: startedAt,
  liveUntil,
  changes,
})

describe("the builds list", () => {
  const now = at(15, 21, 0)
  const b = build(2, "bbbbbbb", at(15, 18, 0), null, ["merge: build history (CEL-50)", "docs: what a build is"])
  const a = build(1, "aaaaaaa", at(14, 9, 30), at(15, 18, 0), [])

  it("names each build, when it went live and for how long, marks the running one, and lists its changes under it", () => {
    expect(buildsText({ builds: [b, a], running: b.id, next: null }, now)).toBe([
      "#2  build bbbbbbb  Cello 0.2.0  live since 2026-11-15 18:00, for 3 h  running",
      "    merge: build history (CEL-50)",
      "    docs: what a build is",
      "#1  build aaaaaaa  Cello 0.2.0  live since 2026-11-14 09:30, for 1 d 8 h",
      "    no changes since the build before it",
    ].join("\n"))
  })

  it("says how to see older builds when there are more", () => {
    expect(buildsText({ builds: [b], running: null, next: 2 }, now).split("\n").at(-1)).toBe("Older builds: cello builds --before 2")
  })

  it("explains an empty history", () => {
    expect(buildsText({ builds: [], running: null, next: null }, now)).toBe(
      "No builds recorded yet. Cello records a build when `cello start` (or the desktop app) serves its web app; a dev server records none.",
    )
  })
})
