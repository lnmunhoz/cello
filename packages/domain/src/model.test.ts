import { describe, expect, it } from "vitest"
import { modelLabel, modelName } from "./model.ts"

describe("modelName", () => {
  it.each([
    ["claude-opus-5-5", "Opus 5.5"],
    ["claude-sonnet-5-5", "Sonnet 5.5"],
    ["claude-haiku-5-5", "Haiku 5.5"],
    ["claude-fable-5-2", "Fable 5.2"],
    // A dated id, a whole-number version and the older family-last form read the same way.
    ["claude-opus-4-5-20251101", "Opus 4.5"],
    ["claude-sonnet-4-20250514", "Sonnet 4"],
    ["claude-3-5-haiku-20241022", "Haiku 3.5"],
    ["claude-opus-5-5[1m]", "Opus 5.5"],
  ])("%s reads %s", (id, name) => {
    expect(modelName(id)).toBe(name)
  })

  it("passes an id it doesn't know through as it is", () => {
    expect(modelName("claude-foo-6")).toBe("claude-foo-6")
    expect(modelName("gpt-7")).toBe("gpt-7")
  })
})

describe("modelLabel", () => {
  it("names the model, then its effort", () => {
    expect(modelLabel("claude-sonnet-5-5", "medium")).toBe("Sonnet 5.5, medium")
    expect(modelLabel("claude-opus-5-5", null)).toBe("Opus 5.5")
  })

  it("is nothing without a model, whatever the effort says", () => {
    expect(modelLabel(null, "high")).toBeNull()
    expect(modelLabel(undefined, undefined)).toBeNull()
  })
})
