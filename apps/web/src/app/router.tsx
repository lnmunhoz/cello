import { createRootRoute, createRoute, createRouter, Navigate, notFound, retainSearchParams, useParams } from "@tanstack/react-router"
import { AgentsPage } from "../agents/AgentsPage.tsx"
import { parseAgentsSearch } from "../agents/layout.ts"
import { DocsPage } from "../docs/DocsPage.tsx"
import { PageReader } from "../docs/PageReader.tsx"
import { parseDocsSearch, parsePageSearch } from "../docs/search.ts"
import { IssuesPage } from "../issues/IssuesPage.tsx"
import { parseIssuesSearch, type IssuesSearch } from "../issues/layout.ts"
import { embedSearch } from "../lib/embed.ts"
import { MilestonePage } from "../milestones/MilestonePage.tsx"
import { MilestonesPage } from "../milestones/MilestonesPage.tsx"
import { ComingSoon } from "../project/ComingSoon.tsx"
import { Overview } from "../project/Overview.tsx"
import { ProjectLayout } from "../project/ProjectLayout.tsx"
import { parseReviewSearch } from "../review/queue.ts"
import { ReviewPage } from "../review/ReviewPage.tsx"
import { BuildsPage } from "../settings/BuildsPage.tsx"
import { parseSettingsSearch, Settings } from "../settings/Settings.tsx"
import { parseTaskSearch } from "../task/view.ts"
import { parseViewerSearch } from "../viewer/search.ts"
import { isEmbedded } from "../viewer/viewer.ts"
import { AppShell, EmbeddedShell } from "./AppShell.tsx"
import { Home } from "./Home.tsx"
import { RouteNotFound } from "./NotFound.tsx"

// Inside a panel (the viewer's iframe, the desktop app's native panel), pages show without the sidebar,
// and every navigation keeps `?embed` (so their task keys still open the task in the main window).
const embedded = isEmbedded({ self: window.self, top: window.top, search: window.location.search })
// `?viewer=…` (CEL-117): what the side panel shows, on any route; navigations drop it unless they keep it.
const root = createRootRoute({
  component: embedded ? EmbeddedShell : AppShell,
  validateSearch: (search: Record<string, unknown>) => ({ ...embedSearch.validateSearch(search), ...parseViewerSearch(search) }),
  search: embedSearch.search,
})

const home = createRoute({ getParentRoute: () => root, path: "/", component: Home })
const settings = createRoute({ getParentRoute: () => root, path: "/settings", component: Settings, validateSearch: parseSettingsSearch })
// Settings → Builds (CEL-50). Static routes win over `$projectKey`; each top-level word is reserved as a
// project key (reservedKeyProblem in packages/shared/src/taskKey.ts).
const builds = createRoute({ getParentRoute: () => root, path: "/builds", component: BuildsPage })
// `?open=CEL-12`: the packet open on the Review page, so a reload or a link keeps it.
const review = createRoute({ getParentRoute: () => root, path: "/review", component: ReviewPage, validateSearch: parseReviewSearch })

// `?layout=list` picks the Issues layout, `?order=newest` its ordering and `?group=milestone` the board's swimlanes (CEL-132); every link inside the project keeps them, so opening and closing tasks stays as it was.
const project = createRoute({
  getParentRoute: () => root,
  path: "$projectKey",
  component: ProjectLayout,
  validateSearch: parseIssuesSearch,
  search: { middlewares: [retainSearchParams<IssuesSearch>(["layout", "order", "group"])] },
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
const task = createRoute({
  getParentRoute: () => project,
  path: "$number",
  component: IssuesPage,
  validateSearch: parseTaskSearch,
  // Only numbers are tasks; anything else here (`/CEL/demo.mp4`) is an address with nothing at it.
  beforeLoad: ({ params }) => {
    if (!/^\d+$/.test(params.number)) throw notFound()
  },
})

// The Milestones page (CEL-132), one milestone's page (`none`: the open tasks without one), and that page
// with a task open beside it: one component for both, so opening a task keeps the page as it was.
const milestones = createRoute({ getParentRoute: () => project, path: "milestones", component: MilestonesPage })
const milestone = createRoute({ getParentRoute: () => project, path: "milestones/$milestoneId", component: MilestonePage })
const milestoneTask = createRoute({
  getParentRoute: () => project,
  path: "milestones/$milestoneId/$number",
  component: MilestonePage,
  validateSearch: parseTaskSearch,
  beforeLoad: ({ params }) => {
    if (!/^\d+$/.test(params.number)) throw notFound()
  },
})

// The Agents page (CEL-65): `?open=session:…` or `?open=agent:…/…`, the open row, so a reload or a link keeps it.
const agents = createRoute({ getParentRoute: () => root, path: "/agents", component: AgentsPage, validateSearch: parseAgentsSearch })

const routeTree = root.addChildren([home, settings, builds, review, agents, project.addChildren([projectIndex, overview, issues, milestones, milestone, milestoneTask, docs, page, activity, task])])

// An address no route matches shows a Not found screen with a way back, in the layout around it.
export const router = createRouter({ routeTree, defaultPreload: false, defaultNotFoundComponent: RouteNotFound })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
