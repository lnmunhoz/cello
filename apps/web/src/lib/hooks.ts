import { useAtomValue } from "@effect/atom-react"
import type * as Atom from "effect/reactivity/Atom"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { useSyncExternalStore } from "react"
import type { BoardState } from "@cello/client/sync/applyEvents"
import { type KeyedTask, projectKeysOf, taskOfKey } from "@cello/client/sync/selectors"
import { boardAtom, currentAtom, syncedAtom } from "./cello.ts"

const boardOf = (result: Atom.Type<typeof boardAtom>): BoardState | null => (AsyncResult.isSuccess(result) ? result.value : null)

/** The board state, or null until the first snapshot arrives (and while a workspace switch loads). */
export const useBoard = (): BoardState | null => boardOf(useAtomValue(boardAtom))

const projectKeysFrom = (result: Atom.Type<typeof boardAtom>): string | undefined => {
  const board = boardOf(result)
  return board ? projectKeysOf(board) : undefined
}

/**
 * The project keys task keys in rendered text can name ("CEL THAI"); undefined until the board loads.
 * Re-renders only when a project key changes, so markdown parsed with it isn't parsed on every change.
 */
export const useProjectKeys = (): string | undefined => useAtomValue(boardAtom, projectKeysFrom)

/** The task a key names, with its status; re-renders only when that task or its status changes. */
export const useKeyedTask = (key: string): KeyedTask | undefined => {
  const task = useAtomValue(boardAtom, (result) => {
    const board = boardOf(result)
    return board ? taskOfKey(board, key) : undefined
  })
  const status = useAtomValue(boardAtom, (result) => (task ? boardOf(result)?.statuses[task.statusId] : undefined))
  return task ? { task, status } : undefined
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
