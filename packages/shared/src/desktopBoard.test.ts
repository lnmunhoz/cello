import { describe, expect, it } from "vitest"
import { parseDesktopBoardCommand } from "./desktopBoard.ts"

describe("parseDesktopBoardCommand: what the board's Settings asks the desktop app (CEL-149)", () => {
  it("takes a switch to a folder and a port", () => {
    expect(parseDesktopBoardCommand({ kind: "switch", dataDir: "~/.cello-release", port: 4757 })).toEqual({
      kind: "switch",
      dataDir: "~/.cello-release",
      port: 4757,
    })
  })

  it("refuses anything else, field by field", () => {
    for (const bad of [null, "switch", [], {}, { kind: "delete" }, { kind: "switch", dataDir: 1, port: 4757 }, { kind: "switch", dataDir: "/x", port: "4757" }]) {
      expect(parseDesktopBoardCommand(bad), JSON.stringify(bad)).toBeNull()
    }
  })
})
