import { useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { useSyncExternalStore } from "react"
import type { BoardState } from "@cello/client/sync/applyEvents"
import { boardAtom, currentAtom, syncedAtom } from "./cello.ts"

/** The board state, or null until the first snapshot arrives (and while a workspace switch loads). */
export const useBoard = (): BoardState | null => {
  const result = useAtomValue(boardAtom)
  return AsyncResult.isSuccess(result) ? result.value : null
}

/** The workspace the app follows, once known. */
export const useWorkspaceId = (): string | null => {
  const result = useAtomValue(currentAtom)
  return AsyncResult.isSuccess(result) && "workspaceId" in result.value.scope ? result.value.scope.workspaceId : null
}

const subscribeTo = new Map<string, (onChange: () => void) => () => void>()

/** Whether a CSS media query matches, following the window as it changes (`(max-width: 767px)`). */
export const useMediaQuery = (query: string): boolean => {
  let subscribe = subscribeTo.get(query)
  if (!subscribe) {
    subscribe = (onChange) => {
      const list = matchMedia(query)
      list.addEventListener("change", onChange)
      return () => list.removeEventListener("change", onChange)
    }
    subscribeTo.set(query, subscribe)
  }
  return useSyncExternalStore(subscribe, () => matchMedia(query).matches)
}

export const useConnection = () => {
  const result = useAtomValue(syncedAtom)
  if (AsyncResult.isSuccess(result)) return result.value.connection
  return AsyncResult.isFailure(result) ? "failed" : "connecting"
}
