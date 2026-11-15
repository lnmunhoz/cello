import { describe, expect, it } from "vitest"
import { holdsDraft, isTextEntry } from "./editing.ts"

describe("a field that takes typing", () => {
  it("is a text input, a textarea or an editable element", () => {
    expect(isTextEntry({ tagName: "INPUT", type: "text" })).toBe(true)
    expect(isTextEntry({ tagName: "INPUT", type: "date" })).toBe(true)
    expect(isTextEntry({ tagName: "TEXTAREA" })).toBe(true)
    expect(isTextEntry({ tagName: "DIV", isContentEditable: true })).toBe(true)
  })

  it("isn't a button, a checkbox, a read-only or disabled field, or nothing", () => {
    expect(isTextEntry({ tagName: "BUTTON" })).toBe(false)
    expect(isTextEntry({ tagName: "INPUT", type: "checkbox" })).toBe(false)
    expect(isTextEntry({ tagName: "TEXTAREA", readOnly: true })).toBe(false)
    expect(isTextEntry({ tagName: "INPUT", type: "text", disabled: true })).toBe(false)
    expect(isTextEntry(null)).toBe(false)
  })
})

describe("a draft a reload would lose", () => {
  it("is a textarea holding text: a comment or a note being written", () => {
    expect(holdsDraft([{ value: "Looks good, but", label: "New comment" }])).toBe(true)
    expect(holdsDraft([{ value: "  ", label: "New comment" }, { value: "", label: "Note" }])).toBe(false)
  })

  it("isn't the task's description, which shows the saved text and saves when it loses focus", () => {
    expect(holdsDraft([{ value: "The saved description", label: "Description" }])).toBe(false)
  })
})
