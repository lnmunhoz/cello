// Settings → Releases (CEL-140), next to Builds: every release of Cello on GitHub with its notes, newest
// first; the one running is marked, and newer ones on the channel as available, with Download. And one
// release's notes alone (`/releases/0.5.1`), which is what What's new opens in the side panel. Only in
// Cello.app: the main process reads the releases (a browser gets a pointer to GitHub instead).
import { CHANNEL_NAMES, releaseMark, type Release, type UpdateState } from "@cello/shared/updates"
import { useParams } from "@tanstack/react-router"
import { ChevronRightIcon, ExternalLinkIcon, RefreshCwIcon } from "lucide-react"
import { useState } from "react"
import { Breadcrumb } from "../app/Breadcrumb.tsx"
import { Centered } from "../app/Home.tsx"
import { Button, ButtonLink } from "../components/ui/Button.tsx"
import { Chip } from "../components/ui/Chip.tsx"
import { Markdown } from "../components/ui/Markdown.tsx"
import { formatDay, relativeTime } from "../lib/format.ts"
import { downloadLabel, updateCommand, useUpdateState } from "./updates.ts"

const RUNNING = "#22C55E"
const AVAILABLE = "#5E6AD2"
const GITHUB_RELEASES = "https://github.com/lnmunhoz/cello/releases"

export function ReleasesPage() {
  const state = useUpdateState()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Breadcrumb crumbs={[{ label: "Settings", link: { to: "/settings" } }, { label: "Releases" }]} />
      {state === null ? (
        <NotInApp />
      ) : (
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <div className="mx-auto flex max-w-2xl flex-col gap-6">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h1 className="text-[15px] font-semibold">Releases</h1>
                <p className="text-[13px] text-muted">
                  Every release of Cello on GitHub, newest first. This Mac runs {state.current}, on the {CHANNEL_NAMES[state.channel]} channel
                  {state.checkedAt !== null ? ` · checked ${relativeTime(state.checkedAt)}` : ""}.
                </p>
              </div>
              <CheckNow state={state} />
            </div>
            <ReleaseList state={state} />
          </div>
        </div>
      )}
    </div>
  )
}

/** `/releases/<version>` in the main area: one release's notes. */
export function ReleaseNotesPage() {
  const { version } = useParams({ from: "/releases/$version" })
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Breadcrumb crumbs={[{ label: "Settings", link: { to: "/settings" } }, { label: "Releases", link: { to: "/releases" } }, { label: version }]} />
      <div className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-2xl">
          <ReleaseNotes version={version} />
        </div>
      </div>
    </div>
  )
}

/** One release's notes, for What's new: the side panel shows this natively, as it does a page. */
export function ReleaseNotes({ version }: { version: string }) {
  const state = useUpdateState()
  if (state === null) return <NotInApp />
  const release = state.releases.find((r) => r.version === version)
  if (!release) {
    return (
      <div className="flex flex-col gap-2 text-[13px] text-muted" data-release-missing={version}>
        <p>{state.checking ? `Asking GitHub for ${version}'s notes…` : `GitHub has no release ${version}${state.error ? ` (${state.error})` : ""}.`}</p>
        <a href={`${GITHUB_RELEASES}/tag/v${version}`} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">
          Look for it on GitHub →
        </a>
      </div>
    )
  }
  return <ReleaseCard release={release} state={state} open framed={false} />
}

function NotInApp() {
  return (
    <Centered>
      <div className="flex flex-col items-center gap-2 text-center">
        <p>Releases and updates show in the Cello app for Mac.</p>
        <a href={GITHUB_RELEASES} target="_blank" rel="noreferrer" className="font-medium text-ink hover:underline">
          See Cello's releases on GitHub →
        </a>
      </div>
    </Centered>
  )
}

function CheckNow({ state }: { state: UpdateState }) {
  return (
    <Button size="sm" disabled={state.checking} onClick={() => updateCommand({ kind: "check" })}>
      <RefreshCwIcon aria-hidden className={`size-3.5 ${state.checking ? "motion-safe:animate-spin" : ""}`} />
      {state.checking ? "Checking…" : "Check now"}
    </Button>
  )
}

function ReleaseList({ state }: { state: UpdateState }) {
  if (state.releases.length === 0) {
    return (
      <div data-releases-empty className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[13px] text-muted">
        {state.checking ? "Asking GitHub…" : state.error ? `Couldn't list the releases: ${state.error}` : "No releases on GitHub yet."}
      </div>
    )
  }
  return (
    <ul aria-label="Releases" className="flex flex-col gap-3">
      {state.releases.map((release) => (
        <li key={release.tag}>
          <ReleaseCard release={release} state={state} open={releaseMark(release, state.current, state.channel) !== null} framed />
        </li>
      ))}
    </ul>
  )
}

/**
 * A release: its version, marks and date, Download when it's the one on offer, and its notes (open for
 * the running and available ones; older ones open on a click).
 */
function ReleaseCard({ release, state, open: initiallyOpen, framed }: { release: Release; state: UpdateState; open: boolean; framed: boolean }) {
  const [open, setOpen] = useState(initiallyOpen)
  const mark = releaseMark(release, state.current, state.channel)
  const offered = state.latest?.version === release.version
  const heading = (
    <>
      <span className="font-semibold text-ink">Cello {release.version}</span>
      {mark === "running" ? <Chip size="sm" color={RUNNING}>Running</Chip> : null}
      {mark === "available" ? <Chip size="sm" color={AVAILABLE}>Available</Chip> : null}
      {release.prerelease ? <Chip size="sm">Preview</Chip> : null}
      <span className="min-w-0 flex-1 truncate text-faint tabular-nums">{release.publishedAt !== null ? formatDay(release.publishedAt) : ""}</span>
    </>
  )
  const body = (
    <div className="flex flex-col gap-3">
      {offered ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" size="sm" disabled={state.status === "downloading"} onClick={() => updateCommand({ kind: "download" })}>
            {downloadLabel(state)}
          </Button>
          <span className="text-xs text-muted">
            {state.latest?.asset ? "Opens the disk image: drag Cello onto Applications." : "No disk image for this Mac: opens the release on GitHub."}
          </span>
        </div>
      ) : null}
      <Markdown source={release.notes} empty="No notes for this release." />
      <ButtonLink href={release.url} variant="more" size="sm">
        <ExternalLinkIcon aria-hidden className="size-3.5" />
        On GitHub
      </ButtonLink>
    </div>
  )
  if (!framed) {
    return (
      <article data-release={release.version} data-release-mark={mark ?? undefined} className="flex flex-col gap-3">
        <h1 className="flex items-center gap-2 text-[15px]">{heading}</h1>
        {body}
      </article>
    )
  }
  return (
    <article data-release={release.version} data-release-mark={mark ?? undefined} className="rounded-lg border border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRightIcon aria-hidden className={`size-3.5 shrink-0 text-faint transition-transform ${open ? "rotate-90" : ""}`} />
        {heading}
      </button>
      {open ? <div className="border-t border-line px-3 py-3 pl-9">{body}</div> : null}
    </article>
  )
}
