import type { BoardState } from "@cello/client/sync/applyEvents"
import { openAskOf, questionCount, roundLabel } from "@cello/client/sync/asks"
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
/**
 * Every ask on the task as one thread, oldest first: "Round 1 · answered", "Round 2 · open" (Lucas,
 * Nov 15: the agent asks again after his answers, so iterating is normal). Each opens to its
 * read-only record; the open one is answered in the pinned box above.
 */
export function AskThread({ task }: { task: Task }) {
  const result = useAtomValue(asksFamily(task.id))
  const asks = AsyncResult.isSuccess(result) ? result.value : []
  if (asks.length === 0) return null
  return (
    <section aria-labelledby="asks-heading" className="flex flex-col gap-2">
      <h3 id="asks-heading" className="text-[13px] font-semibold">
        Questions
      </h3>
      <ol className="flex flex-col gap-1.5">
        {asks.map((ask) => (
          <Round key={ask.id} label={roundLabel(asks, ask)} ask={ask} />
        ))}
      </ol>
    </section>
  )
}

function Round({ label, ask }: { label: string; ask: Ask }) {
  const [open, setOpen] = useState(false)
  return (
    <li data-ask-id={ask.id} data-round={label} className="rounded-lg border border-line bg-raised shadow-card">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRightIcon aria-hidden className={`size-3.5 shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
        <span className={`shrink-0 font-semibold ${ask.state === "open" ? "text-accent" : "text-ink"}`}>{label}</span>
        <span className="min-w-0 truncate text-muted">{ask.title}</span>
        <span className="shrink-0 text-faint">· {ask.state === "open" ? "answer it above" : closedLabel(ask)}</span>
      </button>
      {open ? (
        <div className="border-t border-line px-3 py-3">
          <AskRecord ask={ask} />
        </div>
      ) : null}
    </li>
  )
}
