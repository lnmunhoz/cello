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

/**
 * Marks a field that shows the saved value and saves when it loses focus (a task's title, a name in
 * Settings): its text is never a draft once it's blurred. Every other text field holding text is one.
 */
export const SAVES_ON_BLUR = { "data-saves-on-blur": "" } as const

/** A text field and what the draft check reads of it. */
export interface DraftField extends FieldLike {
  readonly value: string
  readonly savesOnBlur: boolean
}

/** Whether any of these fields holds text that isn't saved: a comment being written, a new label's name typed and left. */
export const holdsDraft = (fields: ReadonlyArray<DraftField>): boolean =>
  fields.some((f) => isTextEntry(f) && !f.savesOnBlur && f.value.trim() !== "")

/** Typing in a field, a dialog open (a new project, a send-back note), or unsaved text in a field. */
export const isEditing = (doc: Document = document): boolean =>
  isTextEntry(doc.activeElement as (Element & FieldLike) | null) ||
  doc.querySelector('[role="dialog"], [role="alertdialog"]') !== null ||
  holdsDraft(
    [...doc.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")].map((f) => ({
      tagName: f.tagName,
      type: f.type,
      readOnly: f.readOnly,
      disabled: f.disabled,
      value: f.value,
      savesOnBlur: f.hasAttribute("data-saves-on-blur"),
    })),
  )
