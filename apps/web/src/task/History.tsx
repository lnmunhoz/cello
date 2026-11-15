import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Task } from "@cello/contract/entities"
import { useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { historyFamily } from "../lib/cello.ts"
import { relativeTime } from "../lib/format.ts"
import { describeEvent } from "@cello/client/history"
import type { CelloEvent } from "@cello/contract/events"
import { whoOf } from "../presence/model.ts"

/** "cello-builder · a13bfb89, under Claude Code session 2fd0505c". */
const named = (board: BoardState, e: CelloEvent) => {
  const who = whoOf(board, e.actorId, e.sessionId, e.agentId)
  return who.parent ? `${who.name}, under ${who.parent}` : who.name
}

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
            {/* A subagent's change names it (CEL-55); its session is in the hover. */}
            <span title={e.agentId ? named(board, e) : undefined}>{describeEvent(e, board, e.agentId ? whoOf(board, e.actorId, e.sessionId, e.agentId).name : undefined)}</span>
            <span className="text-faint">· {relativeTime(e.ts)}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
