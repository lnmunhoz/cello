// The full-screen compare view of a question (CEL-47): its options side by side (columns) or stacked
// (rows), the choice remembered on this device.

export type CompareLayout = "columns" | "rows"

/** This device's last choice of layout, in localStorage. */
export const COMPARE_LAYOUT_KEY = "cello:ask-compare-layout"

/** Columns, unless rows was chosen. */
export const readCompareLayout = (stored: string | null): CompareLayout => (stored === "rows" ? "rows" : "columns")

const MOST_SIDE_BY_SIDE = 4

/**
 * How many options sit side by side in columns: all of them up to four; more wrap into rows as even as
 * can be (5 → 3 + 2, 9 → 3 + 3 + 3), so no option ends up alone and narrow.
 */
export const columnsFor = (count: number): number =>
  count <= MOST_SIDE_BY_SIDE ? Math.max(1, count) : Math.ceil(count / Math.ceil(count / MOST_SIDE_BY_SIDE))
