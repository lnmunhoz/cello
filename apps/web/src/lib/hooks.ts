import { useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import type { BoardState } from "@cello/client/sync/applyEvents"
import { taskFinder } from "@cello/client/sync/selectors"
import type { FindTask } from "../task/TaskKey.tsx"
import { boardAtom, currentAtom, syncedAtom } from "./cello.ts"

/** The board state, or null until the first snapshot arrives (and while a workspace switch loads). */
export const useBoard = (): BoardState | null => {
  const result = useAtomValue(boardAtom)
  return AsyncResult.isSuccess(result) ? result.value : null
}

/** Finds tasks by key on the live board, for task keys in rendered text; undefined until the board loads. */
export const useTaskFinder = (): FindTask | undefined => {
  const board = useBoard()
  return board ? taskFinder(board) : undefined
}

/** The workspace the app follows, once known. */
export const useWorkspaceId = (): string | null => {
  const result = useAtomValue(currentAtom)
  return AsyncResult.isSuccess(result) && "workspaceId" in result.value.scope ? result.value.scope.workspaceId : null
}

export const useConnection = () => {
  const result = useAtomValue(syncedAtom)
  if (AsyncResult.isSuccess(result)) return result.value.connection
  return AsyncResult.isFailure(result) ? "failed" : "connecting"
}
