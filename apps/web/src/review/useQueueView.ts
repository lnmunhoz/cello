import type { Project } from "@cello/contract/entities"
import { useEffect, useState } from "react"
import { useStored, writeStored } from "../lib/storage.ts"
import { ALL, parseProjectPick, type QueuePage, viewKey } from "./queueView.ts"

/**
 * The project a queue page is narrowed to (null: All), kept on this device, one pick per page, and how
 * to pick another. `instant` is true for the render a pick makes, so the page snaps its rows instead of
 * animating them: the human's own view changes don't animate, events do (CEL-188).
 */
export const useQueueView = (
  page: QueuePage,
  projects: ReadonlyArray<Project>,
): { readonly picked: Project | null; readonly pick: (next: Project | null) => void; readonly instant: boolean } => {
  const key = viewKey(page, "project")
  const stored = useStored(key)
  const picked = parseProjectPick(stored, projects)
  const [instantFor, setInstantFor] = useState<string | null>(null)
  const now = picked?.key ?? ALL
  // Only the commit a pick makes: the effect clears it, so a later event animates as usual.
  useEffect(() => {
    if (instantFor !== null) setInstantFor(null)
  }, [instantFor])
  const pick = (next: Project | null) => {
    setInstantFor(next?.key ?? ALL)
    writeStored(key, next?.key ?? ALL)
  }
  return { picked, pick, instant: instantFor === now }
}
