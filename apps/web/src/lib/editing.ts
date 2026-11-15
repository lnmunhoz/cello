// Whether reloading the page now would lose something Lucas is doing (CEL-37): a new build only reloads
// by itself when nothing is being edited.

/** As much of an element as the checks read. */
export interface FieldLike {
  readonly tagName: string
  readonly type?: string
  readonly isContentEditable?: boolean
  readonly readOnly?: boolean
  readonly disabled?: boolean
}

const NOT_TEXT = new Set(["button", "checkbox", "color", "file", "hidden", "image", "radio", "range", "reset", "submit"])

/** A field that takes typing: a text-like input, a textarea, or an editable element. */
export const isTextEntry = (element: FieldLike | null): boolean => {
  if (element === null || element.disabled || element.readOnly) return false
  if (element.isContentEditable) return true
  if (element.tagName === "TEXTAREA") return true
  return element.tagName === "INPUT" && !NOT_TEXT.has((element.type ?? "text").toLowerCase())
}

/** Fields that show the saved text and save when they lose focus, so their text is never a draft. */
const SAVED_ON_BLUR = new Set(["Description"])

/** Whether any of these textareas holds text that isn't saved yet: a comment or a note being written. */
export const holdsDraft = (textareas: ReadonlyArray<{ readonly value: string; readonly label: string | null }>): boolean =>
  textareas.some((t) => t.value.trim() !== "" && !SAVED_ON_BLUR.has(t.label ?? ""))

/** Typing in a field, a dialog open (a new project, a send-back note), or a draft in a textarea. */
export const isEditing = (doc: Document = document): boolean =>
  isTextEntry(doc.activeElement as (Element & FieldLike) | null) ||
  doc.querySelector('[role="dialog"], [role="alertdialog"]') !== null ||
  holdsDraft([...doc.querySelectorAll("textarea")].map((t) => ({ value: t.value, label: t.getAttribute("aria-label") })))
