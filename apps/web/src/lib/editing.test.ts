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
  const field = (value: string, savesOnBlur = false) => ({ tagName: "INPUT", type: "text", value, savesOnBlur })

  it("is a textarea holding text: a comment or a note being written", () => {
    expect(holdsDraft([{ tagName: "TEXTAREA", value: "Looks good, but", savesOnBlur: false }])).toBe(true)
    expect(holdsDraft([{ tagName: "TEXTAREA", value: "  ", savesOnBlur: false }, { tagName: "TEXTAREA", value: "", savesOnBlur: false }])).toBe(false)
  })

  it("is a text input typed in and left, like Settings' New label name or New workspace name", () => {
    expect(holdsDraft([field("bug")])).toBe(true)
    expect(holdsDraft([field("")])).toBe(false)
  })

  it("isn't a field that shows the saved value and saves when it loses focus: a task's title, description or due date, a name in Settings", () => {
    expect(holdsDraft([field("Ship the reload bar", true), { tagName: "TEXTAREA", value: "The saved description", savesOnBlur: true }])).toBe(false)
  })

  it("isn't a field that takes no typing, like a checkbox", () => {
    expect(holdsDraft([{ tagName: "INPUT", type: "checkbox", value: "on", savesOnBlur: false }])).toBe(false)
  })
})
