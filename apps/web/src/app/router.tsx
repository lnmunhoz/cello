import { createRootRoute, createRoute, createRouter, Navigate, retainSearchParams, useParams } from "@tanstack/react-router"
import { DocsPage } from "../docs/DocsPage.tsx"
import { PageReader } from "../docs/PageReader.tsx"
import { parseDocsSearch, parsePageSearch } from "../docs/search.ts"
import { IssuesPage } from "../issues/IssuesPage.tsx"
import { parseIssuesSearch, type IssuesSearch } from "../issues/layout.ts"
import { embedSearch } from "../lib/embed.ts"
import { ComingSoon } from "../project/ComingSoon.tsx"
import { Overview } from "../project/Overview.tsx"
import { ProjectLayout } from "../project/ProjectLayout.tsx"
import { parseReviewSearch } from "../review/queue.ts"
import { ReviewPage } from "../review/ReviewPage.tsx"
import { BuildsPage } from "../settings/BuildsPage.tsx"
import { Settings } from "../settings/Settings.tsx"
import { parseTaskSearch } from "../task/view.ts"
import { isEmbedded } from "../viewer/viewer.ts"
import { AppShell, EmbeddedShell } from "./AppShell.tsx"
import { Home } from "./Home.tsx"

// Inside a panel (the viewer's iframe, the desktop app's native panel), pages show without the sidebar,
// and every navigation keeps `?embed` (so their task keys still open the task in the main window).
const embedded = isEmbedded({ self: window.self, top: window.top, search: window.location.search })
const root = createRootRoute({ component: embedded ? EmbeddedShell : AppShell, ...embedSearch })

const home = createRoute({ getParentRoute: () => root, path: "/", component: Home })
const settings = createRoute({ getParentRoute: () => root, path: "/settings", component: Settings })
// Settings → Builds (CEL-50). Static routes win over `$projectKey`; each top-level word is reserved as a
// project key (reservedKeyProblem in packages/shared/src/taskKey.ts).
const builds = createRoute({ getParentRoute: () => root, path: "/builds", component: BuildsPage })
// `?open=CEL-12`: the packet open on the Review page, so a reload or a link keeps it.
const review = createRoute({ getParentRoute: () => root, path: "/review", component: ReviewPage, validateSearch: parseReviewSearch })

// `?layout=list` picks the Issues layout and `?order=newest` its ordering; every link inside the project keeps them, so opening and closing tasks stays as it was.
const project = createRoute({
  getParentRoute: () => root,
  path: "$projectKey",
  component: ProjectLayout,
  validateSearch: parseIssuesSearch,
  search: { middlewares: [retainSearchParams<IssuesSearch>(["layout", "order"])] },
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
// The reader for every kind of document.
const page = createRoute({ getParentRoute: () => project, path: "pages/$slug", component: PageReader, validateSearch: parsePageSearch })
const activity = createRoute({ getParentRoute: () => project, path: "activity", component: () => <ComingSoon what="Activity" when="M3" /> })
// The same component as `issues`, so opening a task keeps the page mounted. `?view=full` shows the task as a full page.
const task = createRoute({ getParentRoute: () => project, path: "$number", component: IssuesPage, validateSearch: parseTaskSearch })

const routeTree = root.addChildren([home, settings, builds, review, project.addChildren([projectIndex, overview, issues, docs, page, activity, task])])

export const router = createRouter({ routeTree, defaultPreload: false })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
