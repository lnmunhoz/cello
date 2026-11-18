// The diff view's own rules (CEL-173), pure so they are tested here and the components only draw them.

/** How a diff shows: one column of lines, old and new side by side, or the file's own text. */
export type DiffMode = "unified" | "split" | "raw"

/**
 * The view width (px) from which Split is offered. Each half then has 360 px, which after its line-number
 * gutter and sign leaves about 40 monospace characters (12.5 px type), enough for a wrapped line of code
 * to read; below it the halves wrap too much, so Unified is the better use of the room. A panel is 560 px
 * wide at first, so Split asks for it to be dragged wider.
 */
export const SPLIT_MIN_WIDTH = 720

export const canSplit = (width: number): boolean => width >= SPLIT_MIN_WIDTH

/** The mode to draw: a chosen Split shows Unified while the view is too narrow for it, and Split again when it's wide. */
export const shownMode = (chosen: DiffMode, width: number): DiffMode => (chosen === "split" && !canSplit(width) ? "unified" : chosen)

export const formatCount = (n: number): string => n.toLocaleString("en-US")

/**
 * The view width (px) from which a diff inside a comment or page offers "Show as" at all. Under it the
 * summary, the control and Copy don't fit on one row in the narrowest task panel (360 px), so only Copy
 * shows, and the diff is drawn Unified.
 */
export const INLINE_SHOW_AS_MIN_WIDTH = 360

/** What the summary row of a diff inside a comment or page offers at this width (Copy is always there). */
export const inlineControls = (width: number): { showAs: boolean; split: boolean } => ({ showAs: width >= INLINE_SHOW_AS_MIN_WIDTH, split: canSplit(width) })

/**
 * The summary row's three pieces: "6 files changed", "+42" and "−17" (a real minus sign), the last two
 * coloured by the view. `files` is null when the diff has no file names to count (only hunks).
 */
export const summaryParts = ({ files, additions, deletions }: { files: number; additions: number; deletions: number }) => ({
  files: files === 0 ? null : `${formatCount(files)} ${files === 1 ? "file" : "files"} changed`,
  additions: `+${formatCount(additions)}`,
  deletions: `−${formatCount(deletions)}`,
})

/** Digits in a line-number column for a file whose largest number is `largest` (two at least, so small files don't jitter). */
export const gutterDigits = (largest: number): number => Math.max(2, String(largest).length)
