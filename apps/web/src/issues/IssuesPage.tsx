import { useParams, useSearch } from "@tanstack/react-router"
import { BoardPage } from "../board/BoardPage.tsx"
import { ListPage } from "../list/ListPage.tsx"
import { layoutOf } from "./layout.ts"

/**
 * The Issues tab, with or without a task open (`/:projectKey/issues`, `/:projectKey/:number`), in the
 * layout the URL names. Both routes use this one component, so opening or closing a task keeps the
 * page as it was (folded groups, row focus) instead of mounting it again.
 */
export function IssuesPage() {
  const { number } = useParams({ strict: false }) as { number?: string }
  const layout = layoutOf(useSearch({ from: "/$projectKey" }))
  const openNumber = number === undefined ? undefined : Number(number)
  return layout === "list" ? <ListPage openNumber={openNumber} /> : <BoardPage openNumber={openNumber} />
}
