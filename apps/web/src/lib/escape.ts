// Esc closes what's on top first. A page's own Esc (the Review page's open row, the viewer) waits while a
// popup that Esc closes is open: the popup library closes it from the document, after the page's own
// handlers have run, so they check here.

const TAKES_ESCAPE = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  // The card a task link shows on hover (CEL-142): it never takes focus, so Esc reaches the page under it.
  '[data-slot="hover-card-content"]',
].join(", ")

/** Whether a dialog, menu, list of options or hover card is open, which Esc closes before the page. */
export const popupTakesEscape = (doc: Pick<Document, "querySelector">): boolean => doc.querySelector(TAKES_ESCAPE) !== null
