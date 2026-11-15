// Markdown helpers for documents (docs, specs and pages), shared by the server (publishing), the CLI
// (finding local images) and the web reader (sections, live highlights). They work line by line:
// they only need block structure (headings, fenced code) and inline links, never a full parse.
// No Node imports: the web app bundles this file.

const MAX_SLUG = 80
const MAX_SUMMARY = 280

/** "Q3: Billing — audit!" → "q3-billing-audit". Empty when nothing is left (e.g. only emoji). */
export const slugify = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG)
    .replace(/-+$/, "")

/** Lowercase letters and digits in words joined by single dashes, at most 80 characters. */
export const isSlug = (value: string): boolean => value.length <= MAX_SLUG && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)

/** `base`, or the first of `base-2`, `base-3`… that isn't taken. */
export const uniqueSlug = (base: string, taken: (slug: string) => boolean): string => {
  if (!taken(base)) return base
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`
    if (!taken(candidate)) return candidate
  }
}

/** The reader's path for a document: `/CEL/pages/billing-audit`. */
export const pagePath = (projectKey: string, slug: string): string => `/${projectKey}/pages/${slug}`

// ── lines and fences ──────────────────────────────────────────────────────────────────────────────

const linesOf = (markdown: string): string[] => markdown.replace(/\r\n?/g, "\n").split("\n")

const FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * Walks lines, telling `visit` whether each one is inside a fenced code block (fence lines count as
 * inside). A fence closes with the same character, at least as long as the one that opened it; one
 * that never closes runs to the end. The one fence rule for documents and for linkify.
 */
export const eachLine = (lines: ReadonlyArray<string>, visit: (line: string, index: number, inCode: boolean) => void) => {
  let open: string | null = null
  lines.forEach((line, index) => {
    const fence = FENCE.exec(line)?.[1]
    if (open === null && fence) {
      open = fence
      visit(line, index, true)
    } else if (open !== null) {
      if (fence && fence[0] === open[0] && fence.length >= open.length && line.trim() === fence) open = null
      visit(line, index, true)
    } else {
      visit(line, index, false)
    }
  })
}

// ── frontmatter, title and summary ────────────────────────────────────────────────────────────────

export interface Parts {
  /** `key: value` pairs from a leading `---` block, keys lowercased. */
  readonly frontmatter: Readonly<Record<string, string>>
  /** Everything after it. */
  readonly content: string
}

const unquote = (value: string) => value.trim().replace(/^(["'])(.*)\1$/, "$2")

/** Splits a leading `---` … `---` block of `key: value` lines from the markdown. */
export const splitFrontmatter = (markdown: string): Parts => {
  const lines = linesOf(markdown)
  if (lines[0]?.trim() !== "---") return { frontmatter: {}, content: markdown }
  const end = lines.findIndex((line, i) => i > 0 && (line.trim() === "---" || line.trim() === "..."))
  if (end === -1) return { frontmatter: {}, content: markdown }
  const frontmatter: Record<string, string> = {}
  for (const line of lines.slice(1, end)) {
    const match = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (match) frontmatter[match[1]!.toLowerCase()] = unquote(match[2]!)
  }
  return { frontmatter, content: lines.slice(end + 1).join("\n") }
}

const H1 = /^ {0,3}#[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/

/** The index of the content's first non-blank line, when it's a `# heading`; else -1. */
const leadingH1 = (lines: ReadonlyArray<string>) => {
  const first = lines.findIndex((line) => line.trim() !== "")
  return first !== -1 && H1.test(lines[first]!) ? first : -1
}

/** The frontmatter `title:`, else the text of a `# heading` on the first line. */
export const titleOf = (markdown: string): string | null => {
  const { frontmatter, content } = splitFrontmatter(markdown)
  if (frontmatter["title"]) return frontmatter["title"]
  const lines = linesOf(content)
  const at = leadingH1(lines)
  return at === -1 ? null : plainText(H1.exec(lines[at]!)![1]!)
}

/** "/tmp/billing_audit-q3.md" → "Billing audit q3". */
export const titleFromFileName = (file: string): string => {
  const base = file.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "").replace(/[-_\s]+/g, " ").trim()
  return base.charAt(0).toUpperCase() + base.slice(1)
}

/** What the reader shows: no frontmatter, and no first `# heading` when it only repeats the title. */
export const readerContent = (markdown: string, title: string): string => {
  const lines = linesOf(splitFrontmatter(markdown).content)
  const at = leadingH1(lines)
  if (at === -1 || plainText(H1.exec(lines[at]!)![1]!) !== title.trim()) return lines.join("\n")
  let next = at + 1
  while (next < lines.length && lines[next]!.trim() === "") next++
  return lines.slice(next).join("\n")
}

/** Inline markdown as plain text: `**Bold** [link](x)` → "Bold link". */
export const plainText = (inline: string): string => {
  const codes: string[] = []
  return inline
    .replace(/(`+)([\s\S]*?[^`])\1(?!`)/g, (_, _ticks, code: string) => `\u0000${codes.push(code.trim()) - 1}\u0000`)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[^\w\\])\*(?!\s)(.+?)\*(?!\w)/g, "$1$2")
    .replace(/(^|[^\w\\])_(?!\s)(.+?)_(?!\w)/g, "$1$2")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/\\([\\`*_{}[\]()#+\-.!|~>])/g, "$1")
    .replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]!)
    .replace(/\s+/g, " ")
    .trim()
}

/** Lines that start something other than a paragraph: headings, lists, quotes, tables, HTML, rules, images. */
const NOT_PARAGRAPH = /^ {0,3}(?:#{1,6}(?:\s|$)|[-*+][ \t]|\d+[.)][ \t]|>|\||<|(?:[-*_][ \t]*){3,}$|!\[)/
const HEADING = /^ {0,3}#{1,6}(?:\s|$)/
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/

/** The first paragraph's plain text, or "" when there is none. Headings, code, tables and lists are skipped. */
const firstParagraph = (content: string): string => {
  const lines = linesOf(content)
  const blank = (i: number) => lines[i]!.trim() === ""
  const skipBlock = (i: number) => {
    while (i < lines.length && !blank(i)) i++
    return i
  }
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    const fence = FENCE.exec(line)?.[1]
    if (blank(i)) i++
    else if (fence) {
      i++
      while (i < lines.length && !(lines[i]!.trim().startsWith(fence) && /^ {0,3}([`~])\1*\s*$/.test(lines[i]!))) i++
      i++
    } else if (HEADING.test(line)) i++
    else if (lines[i + 1] !== undefined && SETEXT.test(lines[i + 1]!)) i += 2
    else if (NOT_PARAGRAPH.test(line) || /^ {4}/.test(line) || (line.includes("|") && TABLE_DELIMITER.test(lines[i + 1] ?? ""))) {
      i = skipBlock(i)
    } else {
      const found: string[] = []
      while (i < lines.length && !blank(i) && !NOT_PARAGRAPH.test(lines[i]!) && !FENCE.test(lines[i]!)) found.push(lines[i++]!.trim())
      return plainText(found.join(" "))
    }
  }
  return ""
}

const truncate = (text: string, max: number) => {
  if (text.length <= max) return text
  const cut = text.slice(0, max)
  const space = cut.lastIndexOf(" ")
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, "")}…`
}

/** The frontmatter `summary:`, else the first paragraph as plain text, at most 280 characters. */
export const summaryOf = (markdown: string): string => {
  const { frontmatter, content } = splitFrontmatter(markdown)
  if (frontmatter["summary"]) return frontmatter["summary"]
  return truncate(firstParagraph(content), MAX_SUMMARY)
}

// ── sections ──────────────────────────────────────────────────────────────────────────────────────

/** The id of the content before the first heading. Headings never get it. */
export const INTRO = "intro"

export interface Section {
  readonly id: string
  readonly level: 2 | 3
  /** Plain text. */
  readonly title: string
}

export interface SectionBlock {
  /** The heading's id, or `INTRO`. */
  readonly id: string
  /** Null for the intro. */
  readonly level: 2 | 3 | null
  readonly title: string
  /** The block's markdown, heading included, without surrounding blank lines. */
  readonly markdown: string
}

const ATX = /^(#{2,3})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/
const SETEXT_H2 = /^ {0,3}-+[ \t]*$/

const trimBlank = (lines: ReadonlyArray<string>) => {
  let start = 0
  let end = lines.length
  while (start < end && lines[start]!.trim() === "") start++
  while (end > start && lines[end - 1]!.trim() === "") end--
  return lines.slice(start, end).join("\n")
}

/**
 * Splits content into blocks at each `##` and `###` heading (at the start of a line, outside code;
 * a one-line paragraph underlined with `---` counts as `##`). Ids are the headings' slugs, made
 * unique; the content before the first heading is the intro.
 */
export const splitSections = (content: string): SectionBlock[] => {
  const lines = linesOf(content)
  const starts: Array<{ index: number; level: 2 | 3; title: string }> = []
  eachLine(lines, (line, i, inCode) => {
    if (inCode) return
    const atx = ATX.exec(line)
    if (atx) {
      starts.push({ index: i, level: atx[1]!.length as 2 | 3, title: atx[2]! })
      return
    }
    const next = lines[i + 1]
    const previousBlank = i === 0 || lines[i - 1]!.trim() === ""
    if (next !== undefined && SETEXT_H2.test(next) && previousBlank && line.trim() !== "" && !NOT_PARAGRAPH.test(line) && !/^ {4}/.test(line)) {
      starts.push({ index: i, level: 2, title: line.trim() })
    }
  })

  const taken = new Set([INTRO])
  const blocks: SectionBlock[] = []
  const intro = trimBlank(lines.slice(0, starts[0]?.index ?? lines.length))
  if (intro !== "") blocks.push({ id: INTRO, level: null, title: "", markdown: intro })
  starts.forEach((start, n) => {
    const title = plainText(start.title)
    const id = uniqueSlug(slugify(title) || "section", (s) => taken.has(s))
    taken.add(id)
    blocks.push({ id, level: start.level, title, markdown: trimBlank(lines.slice(start.index, starts[n + 1]?.index ?? lines.length)) })
  })
  return blocks
}

/** The `##` and `###` headings, for a table of contents. */
export const sectionsOf = (content: string): Section[] =>
  splitSections(content).flatMap((b) => (b.level === null ? [] : [{ id: b.id, level: b.level, title: b.title }]))

const normalized = (markdown: string) => markdown.split("\n").map((l) => l.trimEnd()).join("\n")

/** Ids of the sections in `after` that are new or read differently than in `before`. */
export const changedSections = (before: string, after: string): string[] => {
  const old = new Map(splitSections(before).map((b) => [b.id, normalized(b.markdown)]))
  return splitSections(after).filter((b) => old.get(b.id) !== normalized(b.markdown)).map((b) => b.id)
}

const REFERENCE = /^( {0,3}\[[^\]]+\]:[ \t]*)(<[^>\n]*>|\S+)(.*)$/

/** Link reference definitions (`[pr]: https://…`) outside code, for rendering one section at a time. */
export const referenceDefinitions = (content: string): string[] => {
  const found: string[] = []
  eachLine(linesOf(content), (line, _i, inCode) => {
    if (!inCode && REFERENCE.test(line)) found.push(line.trim())
  })
  return found
}

// ── link targets ──────────────────────────────────────────────────────────────────────────────────

export interface LinkTarget {
  /** As written, with `<…>` removed and percent-escapes decoded. */
  readonly target: string
  readonly image: boolean
}

/** What to put in place of a target, or null to keep it. */
export type MapTarget = (link: LinkTarget) => string | null | undefined

const INLINE_LINK =
  /(!?)\[((?:[^[\]\\]|\\.|\[(?:[^[\]\\]|\\.)*\](?:\([^)]*\))?)*)\]\(([ \t]*)(<[^>\n]*>|[^\s()]+(?:\([^\s()]*\)[^\s()]*)*)((?:[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t]*)\)/g

const decode = (raw: string) => {
  const target = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw
  try {
    return decodeURI(target)
  } catch {
    return target
  }
}

const replaceTarget = (raw: string, link: LinkTarget, map: MapTarget) => {
  const next = map(link)
  if (next === null || next === undefined) return raw
  return raw.startsWith("<") ? `<${next}>` : next
}

/** Maps the links in text outside code spans; a link's own text is mapped too (an image inside a link). */
const mapInline = (text: string, map: MapTarget): string =>
  text.replace(INLINE_LINK, (_all, bang: string, label: string, pre: string, raw: string, rest: string) => {
    const inner = mapInline(label, map)
    return `${bang}[${inner}](${pre}${replaceTarget(raw, { target: decode(raw), image: bang === "!" }, map)}${rest})`
  })

/** Splits a line into code spans (kept as they are) and the text between them. */
const mapOutsideCode = (line: string, map: (text: string) => string) => {
  let out = ""
  let i = 0
  while (i < line.length) {
    const tick = line.indexOf("`", i)
    if (tick === -1) {
      out += map(line.slice(i))
      break
    }
    let run = tick
    while (line[run] === "`") run++
    const ticks = line.slice(tick, run)
    const close = new RegExp(`(?<!\`)${ticks}(?!\`)`, "g")
    close.lastIndex = run
    const end = close.exec(line)
    out += map(line.slice(i, tick))
    if (end === null) {
      // No closing run: the backticks are literal.
      out += ticks
      i = run
    } else {
      out += line.slice(tick, end.index + ticks.length)
      i = end.index + ticks.length
    }
  }
  return out
}

/**
 * Rewrites link and image targets outside code: inline `[text](target "title")`, `![alt](target)`
 * and reference definitions `[ref]: target`. Everything else is left exactly as written.
 */
export const mapLinkTargets = (markdown: string, map: MapTarget): string => {
  const lines = linesOf(markdown)
  const out: string[] = []
  eachLine(lines, (line, _i, inCode) => {
    if (inCode) {
      out.push(line)
      return
    }
    const reference = REFERENCE.exec(line)
    if (reference) {
      out.push(reference[1]! + replaceTarget(reference[2]!, { target: decode(reference[2]!), image: false }, map) + reference[3]!)
      return
    }
    out.push(mapOutsideCode(line, (text) => mapInline(text, map)))
  })
  return out.join("\n")
}

/** Every link and image target outside code, in reading order (an image inside a link comes first). */
export const linkTargets = (markdown: string): LinkTarget[] => {
  const found: LinkTarget[] = []
  mapLinkTargets(markdown, (link) => {
    found.push(link)
    return null
  })
  return found
}
