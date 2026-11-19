import { describe, expect, it } from "vitest"
import { matchesQuery, reviewFields, searchRows } from "./search.ts"

describe("searchRows: the Review page's rows that match, keeping the ones saying what was decided (CEL-190)", () => {
  const row = (key: string, title: string, author: string | null) => ({ task: { key, title }, author })
  const rows = [row("CEL-3", "Fold the rows", "Claude Code session 11aa"), row("THAI-2", "Prices in baht", "cello-builder"), row("CEL-7", "Search box", null)]
  const found = (query: string, keep?: ReadonlySet<string>) => searchRows(rows, query, reviewFields, keep).map((r) => r.task.key)

  it("no query is every row, in the same order", () => {
    expect(found("")).toEqual(["CEL-3", "THAI-2", "CEL-7"])
    expect(found("  ")).toEqual(["CEL-3", "THAI-2", "CEL-7"])
  })

  it("finds by agent, task key or title", () => {
    expect(found("builder")).toEqual(["THAI-2"])
    expect(found("cel-")).toEqual(["CEL-3", "CEL-7"])
    expect(found("baht")).toEqual(["THAI-2"])
    expect(found("nothing like it")).toEqual([])
  })

  it("keeps a row whose decision is pending or just made, whatever the query", () => {
    expect(found("baht", new Set(["CEL-3"]))).toEqual(["CEL-3", "THAI-2"])
  })
})

describe("matchesQuery: the search box on the Review and Agents pages (CEL-190)", () => {
  const fields = ["CEL-190", "Review and Agents quality of life", "Claude Code session 8a41c9e2"]

  it("an empty query, or only spaces, matches everything: the page is as it was", () => {
    expect(matchesQuery(fields, "")).toBe(true)
    expect(matchesQuery(fields, "   ")).toBe(true)
  })

  it("finds a task key, a title word or an agent, without regard to case", () => {
    expect(matchesQuery(fields, "cel-190")).toBe(true)
    expect(matchesQuery(fields, "QUALITY")).toBe(true)
    expect(matchesQuery(fields, "8a41")).toBe(true)
    expect(matchesQuery(fields, "thai-5")).toBe(false)
  })

  it("every word must be found, each in any field, in any order", () => {
    expect(matchesQuery(fields, "quality 8a41")).toBe(true)
    expect(matchesQuery(fields, "life cel")).toBe(true)
    expect(matchesQuery(fields, "quality missing")).toBe(false)
  })

  it("a row with no fields matches only the empty query", () => {
    expect(matchesQuery([], "")).toBe(true)
    expect(matchesQuery([], "a")).toBe(false)
  })
})
