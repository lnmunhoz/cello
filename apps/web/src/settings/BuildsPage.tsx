// Settings → Builds (CEL-50): every build of Cello this board has run, newest first and grouped by the
// day each went live. The running one is marked; a row opens to list the commits merged since the
// previous build, with their task keys linked and showing each task's live status.
import type { BuildPage, BuildRecord } from "@cello/contract/build"
import { byDay, liveFor, liveSince, shortCommit } from "@cello/release/build"
import { useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { ChevronRightIcon } from "lucide-react"
import { useState } from "react"
import { Breadcrumb } from "../app/Breadcrumb.tsx"
import { Centered } from "../app/Home.tsx"
import { Button } from "../components/ui/Button.tsx"
import { Chip } from "../components/ui/Chip.tsx"
import { BUILDS_PAGE } from "../lib/build.ts"
import { buildsFamily } from "../lib/cello.ts"
import { Linkified } from "../viewer/ViewerLink.tsx"

/** How many builds a page shows at first, and how many more "Show older builds" adds. */
const PAGE = BUILDS_PAGE
const RUNNING = "#22C55E"

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

export function BuildsPage() {
  const [limit, setLimit] = useState(PAGE)
  // While a longer list loads, the shorter one stays on screen.
  const current = useAtomValue(buildsFamily(limit))
  const previous = useAtomValue(buildsFamily(Math.max(PAGE, limit - PAGE)))
  const page: BuildPage | null = AsyncResult.isSuccess(current) ? current.value : AsyncResult.isSuccess(previous) ? previous.value : null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Breadcrumb crumbs={[{ label: "Settings", link: { to: "/settings" } }, { label: "Builds" }]} />
      {page === null ? (
        <Centered>Loading builds…</Centered>
      ) : (
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            <div>
              <h1 className="text-[15px] font-semibold">Builds</h1>
              <p className="text-[13px] text-muted">
                Every build of Cello this board has run, newest first. A build is recorded the first time the server starts on it.
              </p>
            </div>
            {page.builds.length === 0 ? <NoBuilds /> : <BuildDays page={page} />}
            {page.next !== null ? (
              <div>
                <Button onClick={() => setLimit(limit + PAGE)}>Show older builds</Button>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}

function NoBuilds() {
  return (
    <div data-builds-empty className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
      <p className="font-medium text-ink">No builds recorded yet</p>
      <p>
        Cello records a build when <code>cello start</code> (or the desktop app) serves its web app. A dev server, where Vite serves the app, records none.
      </p>
    </div>
  )
}

function BuildDays({ page }: { page: BuildPage }) {
  const now = Date.now()
  const oldest = page.next === null ? page.builds.at(-1)?.id : undefined
  return byDay(page.builds, now).map(({ day, builds }) => (
    <section key={day} aria-label={day} className="flex flex-col gap-2">
      <h2 className="text-xs font-medium text-muted">{day}</h2>
      <ul className="divide-y divide-line rounded-lg border border-line">
        {builds.map((build) => (
          <BuildRow key={build.id} build={build} running={build.id === page.running} first={build.id === oldest} now={now} />
        ))}
      </ul>
    </section>
  ))
}

function BuildRow({ build, running, first, now }: { build: BuildRecord; running: boolean; first: boolean; now: number }) {
  const [open, setOpen] = useState(running)
  const changes = build.changes.length
  return (
    <li data-build-row={build.number} data-running={running || undefined}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRightIcon aria-hidden className={`size-3.5 shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="font-medium text-ink tabular-nums">#{build.number}</span>
        <span className="text-muted tabular-nums">build {shortCommit(build.commit)}</span>
        {running ? <Chip size="sm" color={RUNNING}>Running</Chip> : null}
        <span className="min-w-0 flex-1 truncate text-faint tabular-nums">
          live since {liveSince(build.startedAt, now)} · for {liveFor((build.liveUntil ?? now) - build.startedAt)}
        </span>
        <span className="shrink-0 text-muted">{changes === 0 ? "no changes" : plural(changes, "change")}</span>
      </button>
      {open ? (
        <div className="flex flex-col gap-2 border-t border-line px-3 py-3 pl-9">
          {changes > 0 ? (
            <ul aria-label={`Changes in build ${build.number}`} className="flex flex-col gap-1.5 text-[13px] leading-snug text-ink">
              {build.changes.map((subject, i) => (
                <li key={i}>
                  <Linkified text={subject} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">No commits between this build and the one before it.</p>
          )}
          <p className="text-xs text-faint tabular-nums">
            Cello {build.version} · commit {build.commit ?? "unknown"} · web built {liveSince(build.webBuiltAt, now)}
            {build.lastStartedAt !== build.startedAt ? ` · last started ${liveSince(build.lastStartedAt, now)}` : ""}
          </p>
          {first ? <p className="text-xs text-faint">The history starts here: builds before this one weren’t recorded.</p> : null}
        </div>
      ) : null}
    </li>
  )
}
