import { createRootRoute, createRoute, createRouter, Navigate, retainSearchParams, useParams } from "@tanstack/react-router"
import { DocsPage } from "../docs/DocsPage.tsx"
import { PageReader } from "../docs/PageReader.tsx"
import { parseDocsSearch, parsePageSearch, type PageSearch } from "../docs/search.ts"
import { IssuesPage } from "../issues/IssuesPage.tsx"
import { parseIssuesSearch, type IssuesSearch } from "../issues/layout.ts"
import { ComingSoon } from "../project/ComingSoon.tsx"
import { Overview } from "../project/Overview.tsx"
import { ProjectLayout } from "../project/ProjectLayout.tsx"
import { parseReviewSearch } from "../review/queue.ts"
import { ReviewPage } from "../review/ReviewPage.tsx"
import { Settings } from "../settings/Settings.tsx"
import { isEmbedded } from "../viewer/viewer.ts"
import { AppShell, EmbeddedShell } from "./AppShell.tsx"
import { Home } from "./Home.tsx"

// Inside a panel (the viewer's iframe, the desktop app's native panel), pages show without the sidebar.
const embedded = isEmbedded({ self: window.self, top: window.top, search: window.location.search })
const root = createRootRoute({ component: embedded ? EmbeddedShell : AppShell })

const home = createRoute({ getParentRoute: () => root, path: "/", component: Home })
const settings = createRoute({ getParentRoute: () => root, path: "/settings", component: Settings })
// `?open=CEL-12`: the packet open on the Review page, so a reload or a link keeps it.
const review = createRoute({ getParentRoute: () => root, path: "/review", component: ReviewPage, validateSearch: parseReviewSearch })

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
const docs = createRoute({ getParentRoute: () => project, path: "docs", component: DocsPage, validateSearch: parseDocsSearch })
// The reader for every kind of document. `?embed=1` shows it without the app shell, for a panel; its
// own links (versions) keep that.
const page = createRoute({
  getParentRoute: () => project,
  path: "pages/$slug",
  component: PageReader,
  validateSearch: parsePageSearch,
  search: { middlewares: [retainSearchParams<PageSearch>(["embed"])] },
})
const activity = createRoute({ getParentRoute: () => project, path: "activity", component: () => <ComingSoon what="Activity" when="M3" /> })
// The same component as `issues`, so opening a task keeps the page mounted.
const task = createRoute({ getParentRoute: () => project, path: "$number", component: IssuesPage })

const routeTree = root.addChildren([home, settings, review, project.addChildren([projectIndex, overview, issues, docs, page, activity, task])])

export const router = createRouter({ routeTree, defaultPreload: false })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
