import type { Project } from "@cello/contract/entities"
import { useEffect, useState } from "react"
import { useStored, writeStored } from "../lib/storage.ts"
import { ALL, parseProjectPick, parseSort, type QueuePage, viewKey } from "./queueView.ts"

/**
 * How a queue page is viewed (CEL-188), kept on this device, one setting per page: the project it's
 * narrowed to (null: All) and its sort (`sorts`' first is the default). `view` names the pair
 * (`CEL/started`): a page that must not animate the human's own view changes keys on it
 * (the Agents page's list) or asks `useJustChanged` (the Review page's folds).
 */
export const useQueueView = <S extends string>(
  page: QueuePage,
  projects: ReadonlyArray<Project>,
  sorts: ReadonlyArray<S>,
): {
  readonly picked: Project | null
  readonly pick: (next: Project | null) => void
  readonly sort: S
  readonly pickSort: (next: S) => void
  readonly view: string
} => {
  const projectKey = viewKey(page, "project")
  const sortKey = viewKey(page, "sort")
  const picked = parseProjectPick(useStored(projectKey), projects)
  const sort = parseSort(useStored(sortKey), sorts)
  return {
    picked,
    sort,
    view: `${picked?.key ?? ALL}/${sort}`,
    pick: (next) => writeStored(projectKey, next?.key ?? ALL),
    pickSort: (next) => writeStored(sortKey, next),
  }
}

/**
 * True for the render in which `view` changed, false from the next one: for a transition that reads
 * its setting once, as it starts, in that render (a Review row folding away reads AnimatePresence's
 * `custom` when it leaves), so the human's pick can fold rows at once while an event's fold springs.
 */
export const useJustChanged = (view: string): boolean => {
  const [seen, setSeen] = useState(view)
  useEffect(() => setSeen(view), [view])
  return seen !== view
}
