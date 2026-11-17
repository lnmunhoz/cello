// The first lines of a task's description, for the hover card on a task link (CEL-142).

/** The most blocks (paragraphs, lists, code blocks) an excerpt shows. */
const MAX_BLOCKS = 3

const isFence = (line: string) => /^\s*(```|~~~)/.test(line)

/** The description's blocks of markdown: split at blank lines, except inside a code block. */
const blocksOf = (source: string): string[] => {
  const blocks: string[] = []
  let block: string[] = []
  let fenced = false
  for (const line of source.split("\n")) {
    if (isFence(line)) fenced = !fenced
    if (!fenced && line.trim() === "") {
      if (block.length > 0) blocks.push(block.join("\n"))
      block = []
    } else block.push(line)
  }
  if (block.length > 0) blocks.push(block.join("\n"))
  return blocks
}

/**
 * Whole blocks from the start, up to `max` characters and three blocks; `more` when something was left
 * out. A first paragraph past `max` is cut at a word, with an ellipsis; a first code block or table
 * stays whole, since cut it wouldn't render (the card clips its height).
 */
export const descriptionExcerpt = (source: string, max = 280): { text: string; more: boolean } => {
  const blocks = blocksOf(source.trim())
  const first = blocks[0]
  if (first === undefined) return { text: "", more: false }
  if (first.length > max && !isFence(first) && !first.trimStart().startsWith("|")) {
    const cut = first.slice(0, max + 1)
    const end = cut.lastIndexOf(" ")
    return { text: `${(end > 0 ? cut.slice(0, end) : first.slice(0, max)).trimEnd()}…`, more: true }
  }
  const taken = [first]
  let length = first.length
  for (const block of blocks.slice(1, MAX_BLOCKS)) {
    length += 2 + block.length
    if (length > max) break
    taken.push(block)
  }
  return { text: taken.join("\n\n"), more: taken.length < blocks.length }
}
