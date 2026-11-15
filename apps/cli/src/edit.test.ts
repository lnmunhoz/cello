// `cello task edit` (CEL-63): its flags as task.update's fields, and priorities by name.
import { describe, expect, it } from "vitest"
import { editFields, priorityOf } from "./edit.ts"

describe("editFields", () => {
  it("keeps only the fields given", () => {
    expect(editFields("CEL-1", { title: "New title" })).toEqual({ title: "New title" })
    expect(editFields("CEL-1", { description: "## Body" })).toEqual({ description: "## Body" })
    expect(editFields("CEL-1", { title: "T", description: "D", priority: "High" })).toEqual({ title: "T", description: "D", priority: 2 })
  })

  it("takes an empty description, which clears it", () => {
    expect(editFields("CEL-1", { description: "" })).toEqual({ description: "" })
  })

  it("refuses when nothing is given, saying how to edit", () => {
    expect(editFields("cel-1", {})).toBe(
      "Say what to change: cello task edit CEL-1 --title \"…\", --description \"…\" (or --body-file - for markdown from stdin), or --priority high.",
    )
  })

  it("refuses an unknown priority", () => {
    expect(editFields("CEL-1", { priority: "asap" })).toBe("No priority \"asap\". Use urgent, high, medium, low or none.")
  })
})

describe("priorityOf", () => {
  it("reads names in any case, and the numbers 0 to 4", () => {
    expect(priorityOf("URGENT")).toBe(1)
    expect(priorityOf("none")).toBe(0)
    expect(priorityOf("4")).toBe(4)
    expect(priorityOf("asap")).toBe("No priority \"asap\". Use urgent, high, medium, low or none.")
  })
})
