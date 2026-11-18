import type { Project } from "@cello/contract/entities"
import { useEffect, useState } from "react"
import { useStored, writeStored } from "../lib/storage.ts"
import { ALL, parseProjectPick, parseSort, type QueuePage, viewKey } from "./queueView.ts"

/**
 * How a queue page is viewed (CEL-188), kept on this device, one setting per page: the project it's
 * narrowed to (null: All) and its sort (`sorts`' first is the default). `instant` is true for the render
 * a pick makes, so the page snaps its rows instead of animating them: the human's own view changes
 * don't animate, events do.
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
  readonly instant: boolean
} => {
  const projectKey = viewKey(page, "project")
  const sortKey = viewKey(page, "sort")
  const picked = parseProjectPick(useStored(projectKey), projects)
  const sort = parseSort(useStored(sortKey), sorts)
  const [instantFor, setInstantFor] = useState<string | null>(null)
  const view = (project: string, by: string) => `${project}/${by}`
  // Only the pick's own frames: motion starts a layout animation on the frame after the commit and reads
  // the row's transition then, so the flag has to outlive that frame (two) before a later event animates as usual.
  useEffect(() => {
    if (instantFor === null) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setInstantFor(null))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [instantFor])
  const pick = (next: Project | null) => {
    setInstantFor(view(next?.key ?? ALL, sort))
    writeStored(projectKey, next?.key ?? ALL)
  }
  const pickSort = (next: S) => {
    setInstantFor(view(picked?.key ?? ALL, next))
    writeStored(sortKey, next)
  }
  return { picked, pick, sort, pickSort, instant: instantFor === view(picked?.key ?? ALL, sort) }
}
