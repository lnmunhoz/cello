import { describe, expect, it } from "vitest"
import { checkProfileValue, compareFields, e2eSurfaces, fieldLabel, missingFields, PROFILE_FIELDS, profileFieldProblem } from "./testingProfile.ts"

describe("profile field names (CEL-89)", () => {
  it("accepts the fixed fields and e2e.<surface>.<part>, nothing else", () => {
    for (const field of PROFILE_FIELDS) expect(profileFieldProblem(field)).toBeNull()
    for (const field of ["e2e.web.run", "e2e.desktop.videos", "e2e.mobile-ios.screenshots"]) expect(profileFieldProblem(field)).toBeNull()
    expect(profileFieldProblem("e2e.web")).toMatch(/^unknown field "e2e.web"/)
    expect(profileFieldProblem("e2e.Web.run")).toMatch(/unknown field/)
    expect(profileFieldProblem("e2e.web.logs")).toMatch(/unknown field/)
    expect(profileFieldProblem("deploy")).toBe(
      'unknown field "deploy". Fields: install, unit, typecheck, ui.runsIn, app.start, app.url, evidence.ui, evidence.cli, review.env, never.touch, ' +
        "and e2e.<surface>.run, e2e.<surface>.videos, e2e.<surface>.screenshots (surface: web, desktop, …)",
    )
  })

  it("ui.runsIn is local or docker; other values are trimmed text", () => {
    expect(checkProfileValue("ui.runsIn", " Docker ")).toEqual({ value: "docker" })
    expect(checkProfileValue("ui.runsIn", "vm")).toEqual({ problem: 'the value of ui.runsIn must be "local" or "docker", not "vm"' })
    expect(checkProfileValue("unit", "  bun run test ")).toEqual({ value: "bun run test" })
    expect(checkProfileValue("unit", "   ")).toEqual({ problem: "the value of unit can't be empty; unset it instead" })
    expect(checkProfileValue("unit", "x".repeat(1001))).toEqual({ problem: "the value of unit is longer than 1000 characters" })
  })

  it("names fields in plain words, and lists the e2e surfaces in order of their first field", () => {
    expect(fieldLabel("app.start")).toBe("Start the app")
    expect(fieldLabel("e2e.desktop.videos")).toBe("desktop e2e: videos folder")
    expect(e2eSurfaces(["unit", "e2e.web.run", "e2e.desktop.run", "e2e.web.videos"])).toEqual(["web", "desktop"])
    expect(["e2e.web.videos", "never.touch", "e2e.desktop.run", "e2e.web.run", "unit", "install"].sort(compareFields)).toEqual([
      "install",
      "unit",
      "never.touch",
      "e2e.desktop.run",
      "e2e.web.run",
      "e2e.web.videos",
    ])
  })
})

const field = (name: string, value: string, source: "detected" | "agent" | "human" = "detected") => ({ field: name, value, source, updatedAt: 0 })

describe("what a profile is missing", () => {
  it("lists the fields a builder needs that nobody set", () => {
    const fields = [field("install", "bun install"), field("unit", "bun run test", "human"), field("e2e.web.run", "bun run test:e2e", "agent")]
    // ui.runsIn has a default (local); review.env and never.touch are optional.
    expect(missingFields(fields)).toEqual(["typecheck", "app.start", "app.url", "evidence.ui", "evidence.cli"])
    expect(missingFields([field("install", "x")])).toEqual([
      "unit",
      "typecheck",
      "app.start",
      "app.url",
      "e2e.<surface>.run",
      "evidence.ui",
      "evidence.cli",
    ])
  })
})
