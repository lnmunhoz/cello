// The Review page's keys on the open packet (CEL-190), kept pure: A approves it, S sends it back.
// Page-local: the app-wide chords are another task's (CEL-58).

/** The parts of a keydown the guard reads. */
export interface DecisionKeyEvent {
  readonly key: string
  readonly metaKey: boolean
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly repeat: boolean
  readonly defaultPrevented: boolean
  /** Where the key went; null when it isn't an element. */
  readonly target: { readonly tagName: string; readonly isContentEditable: boolean } | null
}

/** Whether a key pressed on `target` is typing: an input, a textarea, a select or anything editable has the key. A target that isn't an element is treated as typing, not guessed at. */
export const typingIn = (target: DecisionKeyEvent["target"]): boolean =>
  target === null || target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)

export type DecisionShortcut = "approve" | "send_back"

const SHORTCUTS: Readonly<Record<string, DecisionShortcut>> = { a: "approve", s: "send_back" }

/**
 * What a key does on the Review page: Approve (A) or Send back (S), or none. Only while a packet is
 * open (`packetOpen`) and no dialog or menu is (`popupOpen`); with no modifier key; not held down; not
 * already handled; and never while typing, where a letter is a letter (an input, a textarea, a select
 * or anything editable has the key).
 */
export const decisionShortcut = (e: DecisionKeyEvent, page: { readonly packetOpen: boolean; readonly popupOpen: boolean }): DecisionShortcut | null => {
  if (!page.packetOpen || page.popupOpen || e.defaultPrevented || e.repeat) return null
  if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return null
  if (typingIn(e.target)) return null
  return SHORTCUTS[e.key.toLowerCase()] ?? null
}

/**
 * Whether a key is Z to undo a decision waiting in its window (CEL-191): only while one waits
 * (`undoable`) and no dialog or menu is open; with no modifier key (⌘Z is the text box's own undo); not
 * held down; not already handled; and never while typing.
 */
export const isUndoKey = (e: DecisionKeyEvent, page: { readonly undoable: boolean; readonly popupOpen: boolean }): boolean =>
  page.undoable && !page.popupOpen && e.key.toLowerCase() === "z" && !e.defaultPrevented && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && !typingIn(e.target)

/**
 * Whether a key is `/` to focus the search box (CEL-190) on the Review and Agents pages: no modifier, not
 * held down, not already handled, not while typing, and not while a dialog or menu is open.
 */
export const isSearchKey = (e: DecisionKeyEvent, popupOpen: boolean): boolean =>
  e.key === "/" && !popupOpen && !e.defaultPrevented && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey && !typingIn(e.target)