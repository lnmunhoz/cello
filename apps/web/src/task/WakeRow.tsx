// Under Working on it in the task panel (CEL-92): what Cello is doing about the claim holder's session
// (./wakeLine.ts says which line), with Wake now and Don't wake before a wake (counting down to it each
// second, CEL-136), Stop while a woken run goes, and its log.
import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Task } from "@cello/contract/entities"
import { useAtomSet } from "@effect/atom-react"
import { Button, ButtonLink } from "../components/ui/Button.tsx"
import { commands } from "../lib/cello.ts"
import { useCountdownNow, useNow } from "../presence/useNow.ts"
import { wakeLine } from "./wakeLine.ts"

export function WakeRow({ task, board }: { task: Task; board: BoardState }) {
  // A wake that's due ticks each second until it runs; anything else moves with the board's clock.
  const slow = useNow()
  const first = wakeLine(task, board, slow)
  const now = useCountdownNow(first?.kind === "scheduled" ? first.at : null)
  const cancel = useAtomSet(commands.cancelWake)
  const wakeNow = useAtomSet(commands.wakeNow)
  const stop = useAtomSet(commands.stopRun)
  const line = wakeLine(task, board, now)
  if (line === null) return null
  return (
    <>
      <dt aria-hidden />
      <dd className="flex min-h-8 min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 text-xs text-muted" data-wake={line.kind}>
        <span className="min-w-0 tabular-nums" title={line.kind === "scheduled" ? `At ${new Date(line.at).toLocaleTimeString()}` : undefined}>
          {line.text}
        </span>
        {line.kind === "scheduled" ? (
          <>
            <Button variant="secondary" size="sm" onClick={() => wakeNow({ key: task.key })}>
              Wake now
            </Button>
            <Button variant="ghost" size="sm" onClick={() => cancel({ taskId: task.id })}>
              Don't wake
            </Button>
          </>
        ) : null}
        {line.kind === "running" ? (
          <Button variant="danger" size="sm" onClick={() => stop({ runId: line.runId })}>
            Stop
          </Button>
        ) : null}
        {line.kind === "running" || line.kind === "ended" ? (
          <ButtonLink variant="ghost" size="sm" href={`/runs/${line.runId}/log`}>
            Log
          </ButtonLink>
        ) : null}
      </dd>
    </>
  )
}
