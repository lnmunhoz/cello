import { createMemoryHistory, createRootRoute, createRoute, createRouter } from "@tanstack/react-router"
import { describe, expect, it } from "vitest"
import { parseReviewSearch } from "../review/queue.ts"
import { embedSearch } from "./embed.ts"

/** The app's root search rules, with the Review page and a task route under them, loaded at `url`. */
const routerAt = async (url: string) => {
  const root = createRootRoute(embedSearch)
  const review = createRoute({ getParentRoute: () => root, path: "/review", validateSearch: parseReviewSearch })
  const task = createRoute({ getParentRoute: () => root, path: "$projectKey/$number" })
  const router = createRouter({ routeTree: root.addChildren([review, task]), history: createMemoryHistory({ initialEntries: [url] }) })
  await router.load()
  return router
}

// buildLocation is what a navigation (a Link, navigate()) commits: the search after the middlewares.
describe("embedSearch: a page in a panel stays embedded however it navigates", () => {
  it("opening and closing a Review row keeps ?embed", async () => {
    const router = await routerAt("/review?embed=1")
    expect(router.buildLocation({ to: "/review", search: { open: "PRB-1" } }).search).toEqual({ embed: 1, open: "PRB-1" })
    expect(router.buildLocation({ to: "/review", search: {} }).search).toEqual({ embed: 1 })
  })

  it("going to another route keeps it too", async () => {
    const router = await routerAt("/review?embed=1&open=PRB-1")
    expect(router.buildLocation({ to: "/$projectKey/$number", params: { projectKey: "PRB", number: "1" } }).search).toEqual({ embed: 1 })
  })

  it("never adds it to a page that wasn't embedded", async () => {
    const router = await routerAt("/review")
    expect(router.buildLocation({ to: "/review", search: { open: "PRB-1" } }).search).toEqual({ open: "PRB-1" })
  })
})
