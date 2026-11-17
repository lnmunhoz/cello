import { describe, expect, it } from "vitest"
import { popupTakesEscape } from "./escape.ts"

/** A page that holds the elements these selectors name: what `querySelector` needs here. */
const pageWith = (...present: string[]) => ({
  querySelector: (selectors: string) => (selectors.split(",").map((s) => s.trim()).some((s) => present.includes(s)) ? ({} as Element) : null),
})

describe("popupTakesEscape: Esc closes the popup first, not the page under it", () => {
  it("a dialog, an alert, a menu or a list of options", () => {
    for (const popup of ['[role="dialog"]', '[role="alertdialog"]', '[role="menu"]', '[role="listbox"]']) expect(popupTakesEscape(pageWith(popup))).toBe(true)
  })

  // CEL-142: Esc on a task link's card closed the card and the Review page's open row with it.
  it("a hover card: the card a task link shows", () => {
    expect(popupTakesEscape(pageWith('[data-slot="hover-card-content"]'))).toBe(true)
  })

  it("nothing open: the page's own Esc", () => {
    expect(popupTakesEscape(pageWith())).toBe(false)
  })
})
