// CSS text the animator writes: selectors that name cards by id, and the rules for cards waiting on a
// step. Pure.

/** A value made safe inside a double-quoted CSS string: backslashes, quotes and line breaks escaped. */
export const cssString = (value: string): string =>
  value.replace(/[\\"\n\r\f]/g, (c) => (c === "\\" ? "\\\\" : c === '"' ? '\\"' : c === "\n" ? "\\a " : c === "\r" ? "\\d " : "\\c "))

/**
 * The rules for cards waiting on a step: hidden at their new slot (`queued`), or keeping the space a
 * copy flies to (`flying`), and holes a flying copy took over (they keep their space, show nothing).
 */
export const stylesFor = (
  pending: ReadonlyMap<string, "queued" | "flying">,
  holes: ReadonlyArray<{ readonly id: number; readonly hidden: boolean }>,
): string => {
  const rules: string[] = []
  for (const [card, p] of pending) rules.push(`[data-card-id="${cssString(card)}"]{${p === "queued" ? "display:none" : "opacity:0"} !important}`)
  for (const h of holes) if (h.hidden) rules.push(`[data-agent-hole="${h.id}"]{visibility:hidden}`)
  return rules.join("\n")
}
