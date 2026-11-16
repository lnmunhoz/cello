import type { ProfileField } from "@cello/contract/entities"
import { describe, expect, it } from "vitest"
import { profileRows, sourceText } from "./profileRows.ts"

const field = (name: string, value: string, source: ProfileField["source"] = "detected"): ProfileField =>
  ({ field: name, value, source, updatedAt: 0, actorId: "a", sessionId: null })

describe("the rows Settings shows for a testing profile (CEL-89)", () => {
  it("every fixed field, set or not, then each e2e surface's three fields, surfaces added here included", () => {
    const rows = profileRows([field("unit", "bun run test", "human"), field("e2e.web.run", "bun run test:e2e")], ["desktop", "web"])
    expect(rows.map((r) => r.field)).toEqual([
      "install", "unit", "typecheck", "ui.runsIn", "app.start", "app.url", "evidence.ui", "evidence.cli", "review.env", "never.touch",
      "e2e.web.run", "e2e.web.videos", "e2e.web.screenshots",
      "e2e.desktop.run", "e2e.desktop.videos", "e2e.desktop.screenshots",
    ])
    expect(rows[1]).toMatchObject({ label: "Unit tests", value: "bun run test", source: "human", surface: null })
    expect(rows[0]).toMatchObject({ label: "Install", value: null, source: null })
    expect(rows[10]).toMatchObject({ label: "web e2e: run", rowLabel: "Run", surface: "web", value: "bun run test:e2e" })
    expect(rows[1]!.rowLabel).toBe("Unit tests")
  })

  it("says where a value came from, with the human as you", () => {
    expect(sourceText({ source: "detected", updatedAt: 0 }, 120_000)).toBe("Detected · 2 min ago")
    expect(sourceText({ source: "agent", updatedAt: 0 }, 1000)).toBe("Agent · just now")
    expect(sourceText({ source: "human", updatedAt: 0 }, 3 * 3_600_000)).toBe("You · 3 h ago")
  })
})
