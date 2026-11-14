import { createRootRoute, createRoute, createRouter, Navigate, useParams } from "@tanstack/react-router"
import { BoardPage } from "../board/BoardPage.tsx"
import { ComingSoon } from "../project/ComingSoon.tsx"
import { Overview } from "../project/Overview.tsx"
import { ProjectLayout } from "../project/ProjectLayout.tsx"
import { Settings } from "../settings/Settings.tsx"
import { AppShell } from "./AppShell.tsx"
import { Home } from "./Home.tsx"

const root = createRootRoute({ component: AppShell })

const home = createRoute({ getParentRoute: () => root, path: "/", component: Home })
const settings = createRoute({ getParentRoute: () => root, path: "/settings", component: Settings })

const project = createRoute({ getParentRoute: () => root, path: "$projectKey", component: ProjectLayout })

const projectIndex = createRoute({
  getParentRoute: () => project,
  path: "/",
  component: function ProjectIndex() {
    const { projectKey } = useParams({ from: "/$projectKey" })
    return <Navigate to="/$projectKey/issues" params={{ projectKey }} replace />
  },
})
const overview = createRoute({ getParentRoute: () => project, path: "overview", component: Overview })
const issues = createRoute({ getParentRoute: () => project, path: "issues", component: () => <BoardPage /> })
const docs = createRoute({ getParentRoute: () => project, path: "docs", component: () => <ComingSoon what="Docs" when="v1.1" /> })
const activity = createRoute({ getParentRoute: () => project, path: "activity", component: () => <ComingSoon what="Activity" when="M3" /> })
const task = createRoute({
  getParentRoute: () => project,
  path: "$number",
  component: function TaskRoute() {
    const { number } = useParams({ from: "/$projectKey/$number" })
    return <BoardPage openNumber={Number(number)} />
  },
})

const routeTree = root.addChildren([home, settings, project.addChildren([projectIndex, overview, issues, docs, activity, task])])

export const router = createRouter({ routeTree, defaultPreload: false })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
