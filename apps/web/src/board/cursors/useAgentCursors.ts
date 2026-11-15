// Wires the board to the animator: the synced state's event batches in, the board's settings and
// Lucas's drags through.
import { CelloClient } from "@cello/client/client"
import type { Synced } from "@cello/client/sync/follow"
import { useAtomSet, useAtomSubscribe } from "@effect/atom-react"
import * as Effect from "effect/Effect"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { useEffect } from "react"
import { runtime, syncedAtom } from "../../lib/cello.ts"
import { useMediaQuery } from "../../lib/hooks.ts"
import { animator } from "./animator.ts"
import { useAgentCursorsShown } from "./settings.ts"

/** Who a session is: `task.get` lists the sessions a task's history names, with their host session id. */
const whoAtom = runtime.fn((key: string) =>
  Effect.gen(function* () {
    const client = yield* CelloClient
    return yield* client["task.get"]({ key })
  }))

/** Stable, so the subscription isn't renewed on every render. Runs before React renders the batch. */
const receive = (result: AsyncResult.AsyncResult<Synced, unknown>) => {
  if (AsyncResult.isSuccess(result)) animator.receive(result.value)
}

/** Agent cursors on the board of `projectId`, while it's on screen. */
export function useAgentCursors(projectId: string) {
  const enabled = useAgentCursorsShown()
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)")
  const lookup = useAtomSet(whoAtom, { mode: "promise" })
  useAtomSubscribe(syncedAtom, receive, { immediate: true })
  useEffect(() => {
    animator.attach({ projectId, enabled, reduced, lookup })
  }, [projectId, enabled, reduced, lookup])
  useEffect(() => () => animator.detach(), [])
}
