import type { Ordering } from "@cello/client/sync/ordering"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { useStored, writeStored } from "../lib/storage.ts"
import { layoutOf, orderingKey, orderingOf, orderSearch } from "./layout.ts"

/**
 * The ordering the Issues tab shows (`?order`, else the one saved for this project and layout), and
 * how to pick another: it's saved on this device and put in the URL.
 */
export const useOrdering = (): { readonly ordering: Ordering; readonly pick: (next: Ordering) => void } => {
  const { projectKey } = useParams({ from: "/$projectKey" })
  const search = useSearch({ from: "/$projectKey" })
  const key = orderingKey(projectKey, layoutOf(search))
  const ordering = orderingOf(search, useStored(key))
  const navigate = useNavigate()
  const pick = (next: Ordering) => {
    writeStored(key, next)
    void navigate({ to: ".", search: (prev) => ({ ...prev, ...orderSearch(next) }) })
  }
  return { ordering, pick }
}
