import type { BoardState } from "@cello/client/sync/applyEvents"
import { openAskOf, questionCount } from "@cello/client/sync/asks"
import type { Ask, Task } from "@cello/contract/entities"
import { useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { ChevronRightIcon } from "lucide-react"
import { useState } from "react"
import { asksFamily } from "../lib/cello.ts"
import { AskForm, AskRecord, closedLabel } from "./AskView.tsx"

/** The open ask, pinned at the top of the task panel (and the task's full page), to answer there. */
export function PinnedAsk({ board, task }: { board: BoardState; task: Task }) {
  const ask = openAskOf(board, task.id)
  if (!ask) return null
  return (
    <section aria-label="Needs your input" className="flex flex-col gap-4 rounded-lg border border-accent/40 bg-sunken p-4">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold">
        <i aria-hidden className="size-1.5 rounded-full bg-accent" />
        Needs your input · {questionCount(ask)}
      </h3>
      <AskForm task={task} ask={ask} />
    </section>
  )
}

/** Earlier asks, closed: newest first, each opening to its read-only record. */
export function EarlierAsks({ task }: { task: Task }) {
  const result = useAtomValue(asksFamily(task.id))
  const closed = AsyncResult.isSuccess(result) ? [...result.value].filter((a) => a.state !== "open").reverse() : []
  if (closed.length === 0) return null
  return (
    <section aria-labelledby="asks-heading" className="flex flex-col gap-2">
      <h3 id="asks-heading" className="text-[13px] font-semibold">
        Questions
      </h3>
      <ul className="flex flex-col gap-1.5">
        {closed.map((ask) => (
          <EarlierAsk key={ask.id} ask={ask} />
        ))}
      </ul>
    </section>
  )
}

function EarlierAsk({ ask }: { ask: Ask }) {
  const [open, setOpen] = useState(false)
  return (
    <li data-ask-id={ask.id} className="rounded-lg border border-line bg-raised shadow-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRightIcon aria-hidden className={`size-3.5 shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="min-w-0 truncate font-medium text-ink">{ask.title}</span>
        <span className="shrink-0 text-faint">· {closedLabel(ask)}</span>
      </button>
      {open ? (
        <div className="border-t border-line px-3 py-3">
          <AskRecord ask={ask} />
        </div>
      ) : null}
    </li>
  )
}
