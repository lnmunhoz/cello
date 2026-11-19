import { describeError } from "@cello/client/commands/describeError"
import { useAtomSet } from "@effect/atom-react"
import * as Cause from "effect/Cause"
import { useEffect, useEffectEvent } from "react"
import { toast } from "../components/ui/Toast.tsx"
import { commands } from "../lib/cello.ts"
import { useBoard } from "../lib/hooks.ts"
import { readStored, removeStored, storedKeys } from "../lib/storage.ts"
import { deferredDecisions, inTurn } from "./deferred.ts"
import { judgePending, parsePending, PENDING_PREFIX, type PendingDecision } from "./pending.ts"
import { withPendingLock } from "./pendingLock.ts"
import { DECISION_LABEL } from "./queue.ts"
import { standingOf } from "./standing.ts"

const NOT_SENT = { decided: "the packet had since been decided or replaced (it may have gone through as the page closed)", old: "it was more than a day old" } as const

/**
 * Sends the decisions that were in their undo window when a page closed or reloaded (CEL-191), once the
 * board has loaded: Lucas clicked Approve, so it is not lost. Mounted in the app shell, so it runs on
 * whichever page the app opens on. Each recorded decision is judged first (pending.ts): it goes only if the
 * packet it was made on is still the one waiting; otherwise it is dropped and he is told. Either way a
 * toast says what happened.
 *
 * One tab sends it: the record's task lock (pendingLock.ts) is taken first, and the record read again
 * under it. A record that another tab's window still holds waits for that tab; one whose page is gone is
 * taken at once. The record is removed when the command has answered.
 */
export function RecoverDecisions() {
  const board = useBoard()
  const approve = useAtomSet(commands.approveReview, { mode: "promiseExit" })
  const sendBack = useAtomSet(commands.sendBackReview, { mode: "promiseExit" })
  const latest = useEffectEvent(() => board)

  const recoverOne = useEffectEvent(async (storageKey: string) => {
    const text = readStored(storageKey)
    if (text === null) return
    const record = parsePending(text)
    if (record === null) return removeStored(storageKey)
    // A window this tab is running itself (the board came back after a reconnect): it sends, not this.
    if (deferredDecisions.busy(record.taskKey)) return
    const current = latest()
    if (!current) return
    const verdict = judgePending(record, Date.now(), current.tasks[record.taskId] ? standingOf(current, record.taskId) : null)
    if (verdict.kind === "later") return
    const label = DECISION_LABEL[record.decision]
    if (verdict.kind === "drop") {
      removeStored(storageKey)
      toast({ id: `recovered-${record.taskKey}`, title: `${record.taskKey}: not sent again`, description: `Your ${label.toLowerCase()} was made before the page closed, and ${NOT_SENT[verdict.reason]}.` })
      return
    }
    const exit = await inTurn(() => sendRecorded(record))
    removeStored(storageKey)
    if (exit._tag === "Success") {
      toast({ id: `recovered-${record.taskKey}`, title: `${label} ${record.taskKey}`, description: "From before the page closed." })
    } else {
      toast.error(`Your ${label.toLowerCase()} of ${record.taskKey}, from before the page closed, was not taken: ${describeError(Cause.squash(exit.cause), { subject: record.taskKey })}`)
    }
  })
  const sendRecorded = (record: PendingDecision) => {
    const withShots = record.attachmentIds.length > 0 ? { attachmentIds: record.attachmentIds } : {}
    return record.decision === "approved"
      ? approve({ key: record.taskKey, ...(record.note === null ? {} : { note: record.note }), ...withShots })
      : sendBack({ key: record.taskKey, note: record.note ?? "", ...withShots })
  }

  const loaded = board !== null
  useEffect(() => {
    if (!loaded) return
    for (const storageKey of storedKeys(PENDING_PREFIX)) void withPendingLock(storageKey.slice(PENDING_PREFIX.length), () => recoverOne(storageKey))
  }, [loaded])
  return null
}
