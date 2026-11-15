// A value in a filter panel (CEL-52): a checkbox, an icon, its name (and a second line, like a session's
// presence), how many tasks it would show. The whole row toggles it.
import { CheckIcon, MinusIcon } from "lucide-react"
import type { ReactNode } from "react"
import { variants } from "./variants.ts"

/** On, off, or partly on (some of the sessions under "An agent"). */
export type Checked = "on" | "off" | "some"

/** The checkbox itself, drawn: a tick when on, a dash when partly on. */
export function CheckMark({ checked }: { checked: Checked }) {
  return (
    <span
      aria-hidden
      data-checked={checked}
      className={`flex size-3.5 shrink-0 items-center justify-center rounded-[4px] border ${checked === "off" ? "border-line-strong bg-surface" : "border-accent bg-accent text-accent-ink"}`}
    >
      {checked === "on" ? <CheckIcon className="size-2.5" strokeWidth={3} /> : checked === "some" ? <MinusIcon className="size-2.5" strokeWidth={3} /> : null}
    </span>
  )
}

const row = variants(
  "group flex w-full min-w-0 items-center gap-2 rounded-md pr-2 text-left text-[13px] text-ink outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring",
  {
    /** `nested`: a value under another one, like a session under "An agent". */
    indent: { none: "pl-2", nested: "pl-5" },
    /** `two`: a second line under the name. */
    lines: { one: "h-7", two: "py-1" },
  },
  { indent: "none", lines: "one" },
)

/** The second line's colour: a session's presence, or quiet. */
const sub = variants("truncate text-[11px] leading-[14px]", { tone: { active: "text-ink", idle: "text-idle", ended: "text-faint", quiet: "text-faint" } }, { tone: "quiet" })

export interface FacetOptionProps {
  readonly name: string
  readonly checked: Checked
  readonly count: number
  readonly onToggle: () => void
  readonly icon?: ReactNode
  /** Shown after the name, on its line: the dots of the sessions under "An agent". */
  readonly after?: ReactNode
  /** A second line under the name. */
  readonly detail?: { readonly text: string; readonly tone: "active" | "idle" | "ended" | "quiet" }
  readonly nested?: boolean
  /** Names the row for tests and styles (`data-facet-option`). */
  readonly id: string
}

export function FacetOption({ name, checked, count, onToggle, icon, after, detail, nested = false, id }: FacetOptionProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked === "some" ? "mixed" : checked === "on"}
      aria-label={name}
      data-facet-option={id}
      onClick={onToggle}
      className={row({ indent: nested ? "nested" : "none", lines: detail ? "two" : "one" })}
    >
      <CheckMark checked={checked} />
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate leading-[18px]">{name}</span>
          {after}
        </span>
        {detail ? <span className={sub({ tone: detail.tone })}>{detail.text}</span> : null}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-faint" data-facet-count>
        {count}
      </span>
    </button>
  )
}
