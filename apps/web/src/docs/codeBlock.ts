// What a fenced code block in markdown is drawn as: a diagram (```mermaid), a diff (```diff, ```patch,
// or an unmarked block holding a whole git diff, CEL-176) or plain code. Pages (Prose) and comments,
// packet summaries, asks and descriptions (Markdown) both ask here, from the children react-markdown
// gives a <pre>, so the two renderers agree on what a block is.
import { parseDiffBlock, parseUnifiedDiff, type ParsedDiff } from "@cello/text/diff"
import { Children, isValidElement, type ReactNode } from "react"

/** The language (from the fence, lower case) and text of a fenced block; null when the children are not one `<code>`. */
export const codeBlockOf = (children: ReactNode): { language: string | null; text: string } | null => {
  const code = Children.toArray(children)[0]
  if (!isValidElement<{ className?: string; children?: ReactNode }>(code) || code.type !== "code") return null
  const language = code.props.className?.split(" ").find((name) => name.startsWith("language-"))?.slice("language-".length)
  return { language: language === undefined ? null : language.toLowerCase(), text: String(code.props.children ?? "") }
}

export type BlockView =
  | { readonly kind: "mermaid"; readonly source: string }
  /** `source` is the block's text without its final newline: what Copy copies. */
  | { readonly kind: "diff"; readonly diff: ParsedDiff; readonly source: string }
  | { readonly kind: "code" }

/**
 * - `mermaid`: a diagram.
 * - `diff` or `patch`: a diff, read loosely (the writer said so: hunks without file headers and miscounted
 *   hunks still show), when it holds at least one change.
 * - no language: a diff only when the text is a whole git diff (the strict parse, as a `.txt` file is
 *   judged), so bare `+`/`-` text such as a test runner's comparison stays code.
 * - any other language stays code: the writer said what it is.
 */
export const blockView = (children: ReactNode): BlockView => {
  const block = codeBlockOf(children)
  if (block === null) return { kind: "code" }
  const source = block.text.replace(/\n$/, "")
  if (block.language === "mermaid") return { kind: "mermaid", source }
  if (block.language === "diff" || block.language === "patch") {
    const diff = parseDiffBlock(source)
    return diff.files.length > 0 ? { kind: "diff", diff, source } : { kind: "code" }
  }
  if (block.language === null) {
    const diff = parseUnifiedDiff(source)
    return diff.files.length > 0 ? { kind: "diff", diff, source } : { kind: "code" }
  }
  return { kind: "code" }
}
