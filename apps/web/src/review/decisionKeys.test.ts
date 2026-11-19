import { describe, expect, it } from "vitest"
import { type DecisionKeyEvent, decisionShortcut, isSearchKey, isUndoKey } from "./decisionKeys.ts"

const press = (key: string, over: Partial<DecisionKeyEvent> = {}): DecisionKeyEvent => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  defaultPrevented: false,
  isComposing: false,
  target: { tagName: "BODY", isContentEditable: false },
  ...over,
})
const OPEN = { packetOpen: true, popupOpen: false, taskPanelOpen: false, focus: "body" as "body" | "list" | "other" }

describe("decisionShortcut: A approves and S sends back the open packet (CEL-190)", () => {
  it("A is approve and S is send back, in either case", () => {
    expect(decisionShortcut(press("a"), OPEN)).toBe("approve")
    expect(decisionShortcut(press("s"), OPEN)).toBe("send_back")
    expect(decisionShortcut(press("A"), OPEN)).toBe("approve")
    expect(decisionShortcut(press("S"), OPEN)).toBe("send_back")
  })

  it("any other key is none", () => {
    for (const key of ["j", "k", "Enter", "Escape", "b", "ArrowDown", "/"]) expect(decisionShortcut(press(key), OPEN)).toBeNull()
  })

  it("only while a packet is open", () => {
    expect(decisionShortcut(press("a"), { ...OPEN, packetOpen: false })).toBeNull()
    expect(decisionShortcut(press("s"), { ...OPEN, packetOpen: false })).toBeNull()
  })

  it("never with a modifier: ⌘A, ⌃S, ⌥A and Shift+A are the browser's or the app's", () => {
    for (const mod of ["metaKey", "ctrlKey", "altKey", "shiftKey"] as const) {
      expect(decisionShortcut(press("a", { [mod]: true }), OPEN)).toBeNull()
      expect(decisionShortcut(press("s", { [mod]: true }), OPEN)).toBeNull()
    }
  })

  it("never while typing: a text field, a textarea, a select or an editable element has the key", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) expect(decisionShortcut(press("a", { target: { tagName, isContentEditable: false } }), OPEN)).toBeNull()
    expect(decisionShortcut(press("s", { target: { tagName: "DIV", isContentEditable: true } }), OPEN)).toBeNull()
  })

  it("other focused elements (a row's button, a link) let it through", () => {
    for (const tagName of ["BUTTON", "A", "ARTICLE"]) expect(decisionShortcut(press("a", { target: { tagName, isContentEditable: false } }), OPEN)).toBe("approve")
  })

  it("never while a dialog or menu is open", () => {
    expect(decisionShortcut(press("a"), { ...OPEN, popupOpen: true })).toBeNull()
    expect(decisionShortcut(press("s"), { ...OPEN, popupOpen: true })).toBeNull()
  })

  it("never while a task's side panel is open over the page, whatever has the focus", () => {
    for (const focus of ["body", "list", "other"] as const) {
      expect(decisionShortcut(press("a"), { ...OPEN, taskPanelOpen: true, focus })).toBeNull()
      expect(decisionShortcut(press("s"), { ...OPEN, taskPanelOpen: true, focus })).toBeNull()
    }
  })

  it("only with the focus on the page itself or in the list of rows: not in the viewer beside the packet, nor the toolbar", () => {
    expect(decisionShortcut(press("a"), { ...OPEN, focus: "body" })).toBe("approve")
    expect(decisionShortcut(press("a"), { ...OPEN, focus: "list" })).toBe("approve")
    expect(decisionShortcut(press("a"), { ...OPEN, focus: "other" })).toBeNull()
    expect(decisionShortcut(press("s"), { ...OPEN, focus: "other" })).toBeNull()
  })

  it("never while an input method is composing", () => {
    expect(decisionShortcut(press("a", { isComposing: true }), OPEN)).toBeNull()
    expect(decisionShortcut(press("s", { isComposing: true }), OPEN)).toBeNull()
  })

  it("never for a key someone already handled, nor a key held down", () => {
    expect(decisionShortcut(press("a", { defaultPrevented: true }), OPEN)).toBeNull()
    expect(decisionShortcut(press("a", { repeat: true }), OPEN)).toBeNull()
  })

  it("a key with no target (not an element) is none rather than a guess", () => {
    expect(decisionShortcut(press("a", { target: null }), OPEN)).toBeNull()
  })
})

describe("isSearchKey: / focuses the search box, but never takes a slash someone is typing (CEL-190)", () => {
  it("is / on the page itself, whatever has the focus that isn't typing", () => {
    expect(isSearchKey(press("/"), false)).toBe(true)
    expect(isSearchKey(press("/", { target: { tagName: "BUTTON", isContentEditable: false } }), false)).toBe(true)
  })

  it("is not another key", () => {
    for (const key of ["a", "s", "?", "Enter"]) expect(isSearchKey(press(key), false)).toBe(false)
  })

  it("is not a slash typed in a field, or in anything editable", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) expect(isSearchKey(press("/", { target: { tagName, isContentEditable: false } }), false)).toBe(false)
    expect(isSearchKey(press("/", { target: { tagName: "DIV", isContentEditable: true } }), false)).toBe(false)
  })

  it("is not with ⌘, ⌃ or ⌥ held, nor held down, nor already handled, nor over a dialog or menu", () => {
    for (const mod of ["metaKey", "ctrlKey", "altKey"] as const) expect(isSearchKey(press("/", { [mod]: true }), false)).toBe(false)
    expect(isSearchKey(press("/", { repeat: true }), false)).toBe(false)
    expect(isSearchKey(press("/", { defaultPrevented: true }), false)).toBe(false)
    expect(isSearchKey(press("/", { isComposing: true }), false)).toBe(false)
    expect(isSearchKey(press("/"), true)).toBe(false)
  })
})

describe("isUndoKey: Z undoes a decision waiting in its window, through the same guard as A and S (CEL-191)", () => {
  const WAITING = { undoable: true, popupOpen: false, taskPanelOpen: false, focus: "body" as "body" | "list" | "other" }

  it("Z, in either case, while a decision waits, with the focus on the page or in the list of rows", () => {
    expect(isUndoKey(press("z"), WAITING)).toBe(true)
    expect(isUndoKey(press("Z"), WAITING)).toBe(true)
    expect(isUndoKey(press("z"), { ...WAITING, focus: "list" })).toBe(true)
  })

  it("not when none waits, or for any other key", () => {
    expect(isUndoKey(press("z"), { ...WAITING, undoable: false })).toBe(false)
    for (const key of ["a", "s", "u", "Enter", "Escape"]) expect(isUndoKey(press(key), WAITING)).toBe(false)
  })

  it("not with the focus in the viewer panel or the toolbar (anywhere but the page and its list)", () => {
    expect(isUndoKey(press("z", { target: { tagName: "BUTTON", isContentEditable: false } }), { ...WAITING, focus: "other" })).toBe(false)
  })

  it("not while a task's side panel is open over the page", () => {
    expect(isUndoKey(press("z"), { ...WAITING, taskPanelOpen: true })).toBe(false)
  })

  it("not while composing (an input method has the key)", () => {
    expect(isUndoKey(press("z", { isComposing: true }), WAITING)).toBe(false)
  })

  it("never while typing, with a modifier (⌘Z undoes the text), held down, handled, or with a dialog open", () => {
    for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) expect(isUndoKey(press("z", { target: { tagName, isContentEditable: false } }), WAITING)).toBe(false)
    expect(isUndoKey(press("z", { target: { tagName: "DIV", isContentEditable: true } }), WAITING)).toBe(false)
    expect(isUndoKey(press("z", { target: null }), WAITING)).toBe(false)
    for (const over of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }, { repeat: true }, { defaultPrevented: true }]) expect(isUndoKey(press("z", over), WAITING)).toBe(false)
    expect(isUndoKey(press("z"), { ...WAITING, popupOpen: true })).toBe(false)
  })
})
