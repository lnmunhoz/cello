import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Task } from "@cello/contract/entities"
import { useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { historyFamily } from "../lib/cello.ts"
import { relativeTime } from "../lib/format.ts"
import { describeEvent } from "@cello/client/history"
import { type CelloEvent, isReadable } from "@cello/contract/events"
import { sessionWho, whoOf, whoSubject } from "../presence/model.ts"

/** "cello-builder · a13bfb89, under Claude Code session 2fd0505c": for the hover. */
const named = (board: BoardState, e: CelloEvent) => {
  const who = whoOf(board, e.actorId, e.sessionId, e.agentId)
  return who.parent ? `${who.name}, under ${who.parent}` : who.name
}

/**
 * Who did it, in the line (CEL-119): "cello-builder (Sonnet 5.5), subagent of 2fd0505c, set the stage…",
 * with the model the change was made with, and by its plain name in a possessive or a wake ("Claude Code
 * session 2fd0505c's comment…"); the human by the actor's name.
 */
const doer = (board: BoardState, e: CelloEvent) =>
  e.sessionId === null ? undefined : whoSubject(whoOf(board, e.actorId, e.sessionId, e.agentId, e))

/** A plain list of what happened to the task, from task.history. */
export function History({ board, task }: { board: BoardState; task: Task }) {
  const result = useAtomValue(historyFamily(task.id))
  const events = AsyncResult.isSuccess(result) ? [...result.value].reverse() : []
  // Who a comment reopened the task for (CEL-110), by its session's name.
  const names = { ...board, sessionName: (id: string) => (board.sessions[id] ? sessionWho(board.sessions[id]).name : undefined) }
  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-2">
      <h3 id="history-heading" className="text-[13px] font-semibold">
        History
      </h3>
      <ol className="flex flex-col gap-1.5">
        {events.map((e) => (
          <li key={e.seq} className="flex items-baseline gap-2 text-xs text-muted">
            <i aria-hidden className="size-1.5 shrink-0 translate-y-[-1px] rounded-full bg-line-strong" />
            {/* An agent's change names it as the main session or a subagent, with its model (CEL-55, CEL-119); the hover has its full name.
                An event this build can't read (a newer server's, CEL-135) says only that a change happened. */}
            {isReadable(e) ? (
              <span title={e.agentId ? named(board, e) : undefined} data-history-event={e.type}>
                {describeEvent(e, names, doer(board, e))}
              </span>
            ) : (
              <span data-history-event="unreadable">{describeEvent(e, names)}</span>
            )}
            {e.ts === undefined ? null : <span className="text-faint">· {relativeTime(e.ts)}</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}
