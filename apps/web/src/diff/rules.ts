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

/** The summary row's three pieces: "6 files changed", "+42" and "−17" (a real minus sign), the last two coloured by the view. */
export const summaryParts = ({ files, additions, deletions }: { files: number; additions: number; deletions: number }) => ({
  files: `${formatCount(files)} ${files === 1 ? "file" : "files"} changed`,
  additions: `+${formatCount(additions)}`,
  deletions: `−${formatCount(deletions)}`,
})

/** Digits in a line-number column for a file whose largest number is `largest` (two at least, so small files don't jitter). */
export const gutterDigits = (largest: number): number => Math.max(2, String(largest).length)
