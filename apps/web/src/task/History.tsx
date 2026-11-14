import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Task } from "@cello/contract/entities"
import { useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { historyFamily } from "../lib/cello.ts"
import { relativeTime } from "../lib/format.ts"
import { describeEvent } from "../lib/history.ts"

/** A plain list of what happened to the task, from task.history. */
export function History({ board, task }: { board: BoardState; task: Task }) {
  const result = useAtomValue(historyFamily(task.id))
  const events = AsyncResult.isSuccess(result) ? [...result.value].reverse() : []
  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-2">
      <h3 id="history-heading" className="text-[13px] font-semibold">
        History
      </h3>
      <ol className="flex flex-col gap-1.5">
        {events.map((e) => (
          <li key={e.seq} className="flex items-baseline gap-2 text-xs text-muted">
            <i aria-hidden className="size-1.5 shrink-0 translate-y-[-1px] rounded-full bg-line-strong" />
            <span>{describeEvent(e, board)}</span>
            <span className="text-faint">· {relativeTime(e.ts)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
