import { createRootRoute, createRoute, createRouter, Navigate, retainSearchParams, useParams } from "@tanstack/react-router"
import { IssuesPage } from "../issues/IssuesPage.tsx"
import { parseIssuesSearch, type IssuesSearch } from "../issues/layout.ts"
import { ComingSoon } from "../project/ComingSoon.tsx"
import { Overview } from "../project/Overview.tsx"
import { ProjectLayout } from "../project/ProjectLayout.tsx"
import { Settings } from "../settings/Settings.tsx"
import { AppShell } from "./AppShell.tsx"
import { Home } from "./Home.tsx"

const root = createRootRoute({ component: AppShell })

const home = createRoute({ getParentRoute: () => root, path: "/", component: Home })
const settings = createRoute({ getParentRoute: () => root, path: "/settings", component: Settings })

// `?layout=list` picks the Issues layout; every link inside the project keeps it, so opening and closing tasks stays in the list.
const project = createRoute({
  getParentRoute: () => root,
  path: "$projectKey",
  component: ProjectLayout,
  validateSearch: parseIssuesSearch,
  search: { middlewares: [retainSearchParams<IssuesSearch>(["layout"])] },
})

const projectIndex = createRoute({
  getParentRoute: () => project,
  path: "/",
  component: function ProjectIndex() {
    const { projectKey } = useParams({ from: "/$projectKey" })
    return <Navigate to="/$projectKey/issues" params={{ projectKey }} replace />
  },
})
const overview = createRoute({ getParentRoute: () => project, path: "overview", component: Overview })
const issues = createRoute({ getParentRoute: () => project, path: "issues", component: IssuesPage })
const docs = createRoute({ getParentRoute: () => project, path: "docs", component: () => <ComingSoon what="Docs" when="v1.1" /> })
const activity = createRoute({ getParentRoute: () => project, path: "activity", component: () => <ComingSoon what="Activity" when="M3" /> })
// The same component as `issues`, so opening a task keeps the page mounted.
const task = createRoute({ getParentRoute: () => project, path: "$number", component: IssuesPage })

const routeTree = root.addChildren([home, settings, project.addChildren([projectIndex, overview, issues, docs, activity, task])])

export const router = createRouter({ routeTree, defaultPreload: false })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
