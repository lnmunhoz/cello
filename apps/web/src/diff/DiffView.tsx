// A unified diff drawn as a diff (CEL-173): one section per file with its status and counts, hunk
// headers, old and new line numbers, added lines green and removed red; unified (one column) or split
// (old left, new right). It takes the parsed diff and the mode, never a URL, so the side panel's text
// view and, later, the review page (CEL-128) draw from the same component. Lines wrap, so nothing
// scrolls sideways, even in a 320 px panel.
import {
  DIFF_LARGE_FILE_LINES,
  diffTotals,
  fileLineCount,
  foldedAtStart,
  splitRows,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
  type ParsedDiff,
} from "@cello/shared/diff"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { useState, type ReactNode } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Chip } from "../components/ui/Chip.tsx"
import { formatCount, gutterDigits, summaryParts } from "./rules.ts"

/** The row above a diff: "6 files changed · +42 −17", and whatever the caller puts at its right (the view's mode toggle). */
export function DiffSummary({ diff, children }: { diff: ParsedDiff; children?: ReactNode }) {
  const parts = summaryParts(diffTotals(diff.files))
  return (
    <div data-diff-summary="" className="flex min-h-9 shrink-0 items-center gap-2 border-b border-line bg-sunken py-1 pr-3 pl-4 text-xs text-muted">
      <span className="min-w-0 flex-1">
        {parts.files === null ? null : `${parts.files} · `}
        <span className="text-diff-add-ink">{parts.additions}</span> <span className="text-diff-remove-ink">{parts.deletions}</span>
      </span>
      {children}
    </div>
  )
}

/**
 * Where the view sits. `panel` is the side panel's text view: it fills it and scrolls, its file headers
 * sticking to the top. `inline` is a diff inside a comment or page (CEL-176): it grows with its content
 * (the panel or page around it scrolls, a scroll box in it would trap the wheel), and its file headers
 * don't stick, which would put them under the task panel's own header.
 */
export type DiffVariant = "panel" | "inline"

const VIEW_CLASS: Record<DiffVariant, string> = {
  panel:
    "min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-surface font-mono text-[12.5px] leading-[1.5] text-ink outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
  inline: "overflow-x-hidden bg-surface font-mono text-[12.5px] leading-[1.5] text-ink",
}

const HEADING_CLASS: Record<DiffVariant, string> = {
  panel: "sticky top-0 z-10 m-0 text-[12.5px] font-normal",
  inline: "m-0 text-[12.5px] font-normal",
}

/**
 * The diff's files. `mode` is what is drawn: the caller decides, from the room it has, whether split
 * fits (rules.ts: shownMode). The summary row above it is the caller's too (DiffSummary).
 *
 * It uses no `h3`, `p` or `pre`: the comment and page styles that restyle those tags (a heading's size
 * and margins, a code block's padding and background) reach into everything they contain, so the view
 * says the same with `role="heading"` and `div`s.
 */
export function DiffView({ diff, mode, label, variant = "panel" }: { diff: ParsedDiff; mode: "unified" | "split"; label: string; variant?: DiffVariant }) {
  const folded = foldedAtStart(diff.files)
  let fileIndex = -1
  return (
    <div
      role="region"
      aria-label={label}
      data-text-view="diff"
      data-diff-mode={mode}
      {...(variant === "panel" ? { tabIndex: 0 } : {})}
      className={VIEW_CLASS[variant]}
    >
      {diff.parts.map((part, i) => {
        if (part.kind === "text") {
          return (
            <div key={i} data-diff-text="" className="m-0 border-b border-line px-4 py-2 font-[inherit] break-words whitespace-pre-wrap text-muted">
              {part.text}
            </div>
          )
        }
        fileIndex++
        return <FileSection key={`${fileIndex}:${part.file.path}`} file={part.file} startFolded={folded[fileIndex] ?? false} mode={mode} variant={variant} />
      })}
    </div>
  )
}

const chipsOf = (file: DiffFile): ReadonlyArray<string> => [
  ...(file.status === "added" ? ["Added"] : []),
  ...(file.status === "deleted" ? ["Deleted"] : []),
  ...(file.status === "renamed" ? [file.similarity !== undefined && file.similarity < 100 ? `Renamed ${file.similarity}%` : "Renamed"] : []),
  ...(file.status === "copied" ? ["Copied"] : []),
  ...(file.binary ? ["Binary"] : []),
  ...(file.oldMode && file.newMode && file.oldMode !== file.newMode ? [`Mode ${file.oldMode} → ${file.newMode}`] : []),
]

const largestLine = (file: DiffFile): number => file.hunks.reduce((n, h) => Math.max(n, h.oldStart + h.oldLines, h.newStart + h.newLines), 0)

function FileSection({ file, startFolded, mode, variant }: { file: DiffFile; startFolded: boolean; mode: "unified" | "split"; variant: DiffVariant }) {
  const [folded, setFolded] = useState(startFolded)
  const lines = fileLineCount(file)
  const name = file.status === "renamed" || file.status === "copied" ? `${file.oldPath ?? ""} → ${file.newPath ?? ""}` : file.path
  const digits = gutterDigits(largestLine(file))
  // Hunks that came with no file header have no name to show and nothing to fold by.
  if (file.headerless) {
    return (
      <div data-diff-file="headerless" className="border-b border-line">
        {file.hunks.map((hunk, i) => (
          <Hunk key={i} hunk={hunk} mode={mode} digits={digits} />
        ))}
      </div>
    )
  }
  return (
    <section aria-label={file.path} data-diff-file={file.status} className="border-b border-line">
      <div role="heading" aria-level={3} className={HEADING_CLASS[variant]}>
        <button
          type="button"
          aria-expanded={!folded}
          onClick={() => setFolded(!folded)}
          className="flex w-full min-w-0 items-center gap-2 border-b border-line bg-sunken px-3 py-1.5 text-left font-[inherit] text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          {folded ? <ChevronRightIcon aria-hidden className="size-3.5 shrink-0 text-muted" /> : <ChevronDownIcon aria-hidden className="size-3.5 shrink-0 text-muted" />}
          <span title={name} className="min-w-0 flex-1 truncate font-medium">
            {name}
          </span>
          {chipsOf(file).map((chip) => (
            <span key={chip} className="shrink-0 font-sans">
              <Chip size="sm">{chip}</Chip>
            </span>
          ))}
          <span className="shrink-0 text-diff-add-ink">+{formatCount(file.additions)}</span>
          <span className="shrink-0 text-diff-remove-ink">{`−${formatCount(file.deletions)}`}</span>
        </button>
      </div>
      {folded ? (
        lines > 0 ? (
          <div data-diff-folded="" className="m-0 flex items-center gap-2 px-4 py-2 font-sans text-xs text-muted">
            <span>
              {lines > DIFF_LARGE_FILE_LINES ? "Large diff" : "Folded"} · {formatCount(lines)} lines
            </span>
            <Button variant="secondary" size="sm" onClick={() => setFolded(false)}>
              Show it
            </Button>
          </div>
        ) : null
      ) : file.binary ? (
        <Note>Binary file, not shown</Note>
      ) : file.hunks.length === 0 ? (
        <Note>{file.status === "added" || file.status === "deleted" ? "Empty file" : "No content changes"}</Note>
      ) : (
        file.hunks.map((hunk, i) => <Hunk key={i} hunk={hunk} mode={mode} digits={digits} />)
      )}
    </section>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div data-diff-note="" className="m-0 px-4 py-2 font-sans text-xs text-muted">
      {children}
    </div>
  )
}

/** A run of bare lines has no header to show; a hunk with no ranges has no line numbers (`unnumbered`), so its lines draw no gutters. */
function Hunk({ hunk, mode, digits }: { hunk: DiffHunk; mode: "unified" | "split"; digits: number }) {
  const numbered = hunk.unnumbered !== true
  return (
    <>
      {hunk.header === "" ? null : (
        <div data-diff-hunk="" className="bg-diff-hunk px-4 py-1 text-[11.5px] break-words whitespace-pre-wrap text-muted">
          {hunk.header}
        </div>
      )}
      {mode === "split"
        ? splitRows(hunk).map((row, i) => (
            <div key={i} data-diff-row="" className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <Cell line={row.left} side="old" digits={digits} numbered={numbered} />
              <Cell line={row.right} side="new" digits={digits} numbered={numbered} />
            </div>
          ))
        : hunk.lines.map((line, i) => <Line key={i} line={line} digits={digits} numbered={numbered} />)}
    </>
  )
}

const TONE = {
  context: { row: "", sign: "text-faint", gutter: "text-faint" },
  add: { row: "bg-diff-add", sign: "text-diff-add-ink", gutter: "text-diff-add-ink/70" },
  remove: { row: "bg-diff-remove", sign: "text-diff-remove-ink", gutter: "text-diff-remove-ink/70" },
} as const

const SIGN = { context: " ", add: "+", remove: "−" } as const

function Gutter({ side, n, digits }: { side: "old" | "new"; n: number | undefined; digits: number }) {
  const attribute = side === "old" ? { "data-old-line": n ?? "" } : { "data-new-line": n ?? "" }
  return (
    <span {...attribute} className="shrink-0 px-1 text-right select-none" style={{ width: `${digits + 2}ch` }}>
      {n ?? ""}
    </span>
  )
}

function LineText({ line }: { line: DiffLine }) {
  return (
    <span className="min-w-0 flex-1 pr-3 pl-1 break-words whitespace-pre-wrap">
      {line.text}
      {line.noNewline ? (
        <span data-diff-noeol="" className="block font-sans text-[11px] text-faint italic select-none">
          No newline at end of file
        </span>
      ) : null}
    </span>
  )
}

/** One line in the unified view: both gutters, the sign, the text. */
function Line({ line, digits, numbered }: { line: DiffLine; digits: number; numbered: boolean }) {
  const tone = TONE[line.kind]
  return (
    <div data-diff-line={line.kind} className={`flex ${tone.row} ${numbered ? "" : "pl-2"}`}>
      {numbered ? (
        <span className={`flex shrink-0 ${tone.gutter}`}>
          <Gutter side="old" n={line.kind === "add" ? undefined : line.oldLine} digits={digits} />
          <Gutter side="new" n={line.kind === "remove" ? undefined : line.newLine} digits={digits} />
        </span>
      ) : null}
      <span className={`w-4 shrink-0 text-center select-none ${tone.sign}`}>{SIGN[line.kind]}</span>
      <LineText line={line} />
    </div>
  )
}

/** One half of a split row: the old side's line number or the new side's, the sign, the text; an empty cell faces an unpaired line. */
function Cell({ line, side, digits, numbered }: { line: DiffLine | null; side: "old" | "new"; digits: number; numbered: boolean }) {
  const border = side === "new" ? "border-l border-line" : ""
  if (!line) return <div data-diff-empty="" className={`bg-sunken ${border}`} />
  const tone = TONE[line.kind]
  const n = side === "old" ? (line.kind === "add" ? undefined : line.oldLine) : line.kind === "remove" ? undefined : line.newLine
  return (
    <div data-diff-line={line.kind} data-diff-side={side} className={`flex min-w-0 ${tone.row} ${border} ${numbered ? "" : "pl-2"}`}>
      {numbered ? (
        <span className={`flex shrink-0 ${tone.gutter}`}>
          <Gutter side={side} n={n} digits={digits} />
        </span>
      ) : null}
      <span className={`w-4 shrink-0 text-center select-none ${tone.sign}`}>{SIGN[line.kind]}</span>
      <LineText line={line} />
    </div>
  )
}
