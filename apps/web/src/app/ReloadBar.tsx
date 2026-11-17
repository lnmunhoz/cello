import type { WebBuild } from "@cello/contract/build"
import { buildsSinceLoaded, reloadAction, shortCommit, type BuildStamp, type ListedBuild, type ReloadAction } from "@cello/shared/build"
import { useAtomRefresh, useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { NoticeBar } from "../components/ui/NoticeBar.tsx"
import { BUILDS_PAGE, loadedBuild, reloadedFor, reloadInto, useServerBuild } from "../lib/build.ts"
import { buildsFamily, serverBuildAtom } from "../lib/cello.ts"
import { isEditing } from "../lib/editing.ts"
import { Linkified } from "../viewer/ViewerLink.tsx"

/** How long "reloading in 5 s" shows before an idle tab reloads by itself. */
export const NOTICE_SECONDS = 5

/**
 * "Cello was updated · Reload" (CEL-37), when the server this tab (re)connected to serves another web
 * build than the one it runs. With nothing being edited it reloads by itself after a short notice;
 * typing (or a draft, or an open dialog) leaves the choice to the Reload button.
 */
export function ReloadBar() {
  const served = useServerBuild()?.web ?? null
  const [action, setAction] = useState<ReloadAction>("none")
  const [left, setLeft] = useState(NOTICE_SECONDS)
  const refresh = useAtomRefresh(serverBuildAtom)

  // Each answer from the server decides afresh.
  useEffect(() => {
    setAction(reloadAction({ loaded: loadedBuild, served, editing: isEditing(), reloadedFor: reloadedFor() }))
    setLeft(NOTICE_SECONDS)
  }, [served])

  // A lazy chunk of the old build that the new server no longer has (a diagram's renderer, say): ask
  // which build the server runs now.
  useEffect(() => {
    const ask = () => refresh()
    window.addEventListener("vite:preloadError", ask)
    return () => window.removeEventListener("vite:preloadError", ask)
  }, [refresh])

  // The notice counts down; starting to type stops it and leaves the button.
  useEffect(() => {
    if (action !== "reload") return
    const tick = setInterval(() => setLeft((n) => n - 1), 1000)
    const stop = () => {
      if (isEditing()) setAction("offer")
    }
    document.addEventListener("focusin", stop)
    document.addEventListener("input", stop)
    return () => {
      clearInterval(tick)
      document.removeEventListener("focusin", stop)
      document.removeEventListener("input", stop)
    }
  }, [action])

  useEffect(() => {
    if (action !== "reload" || left > 0 || served === null) return
    if (isEditing()) setAction("offer")
    else reloadInto(served)
  }, [action, left, served])

  if (action === "none" || served === null || loadedBuild === null) return null
  return (
    <UpdateNotice
      action={action}
      left={left}
      loaded={loadedBuild}
      served={served}
      // Reading what's in the build is reason enough to wait: the countdown stops, Reload stays.
      onOpen={() => setAction("offer")}
    />
  )
}

/**
 * The notice itself. Its chevron opens what reloading brings in (CEL-148): each build since the one
 * this tab runs, newest first, with the commits merged in it and their task keys linked. Closed at
 * first, so it stays one line.
 */
function UpdateNotice({ action, left, loaded, served, onOpen }: {
  action: "offer" | "reload"
  left: number
  loaded: BuildStamp
  served: WebBuild
  onOpen: () => void
}) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  // The Builds page's first page: the same request, asked again when the server's build changes.
  const history = useAtomValue(buildsFamily(BUILDS_PAGE))
  const { builds, missed } = buildsSinceLoaded({
    loaded,
    served,
    history: AsyncResult.isSuccess(history) ? history.value.builds : null,
  })
  return (
    <NoticeBar
      data-reload-bar={action}
      details={
        open ? (
          <div id={detailsId} className="flex max-h-80 flex-col gap-3 overflow-y-auto px-3 py-2.5 whitespace-normal">
            {builds.map((build) => (
              <NewBuild key={build.webBuiltAt} build={build} />
            ))}
            {missed ? <p className="text-xs text-faint">Builds before this one aren’t listed: the build this tab runs isn’t in the build history.</p> : null}
          </div>
        ) : null
      }
    >
      <RefreshCwIcon aria-hidden className="size-3.5 text-accent" />
      <span className="font-medium">Cello was updated</span>
      <span className="text-muted">· build {shortCommit(served.commit)}</span>
      {action === "reload" ? <span className="text-muted tabular-nums">· reloading in {Math.max(left, 0)} s</span> : null}
      <span className="flex-1" />
      <Button
        variant="ghost"
        size="icon"
        aria-label="What's in this build"
        aria-expanded={open}
        aria-controls={open ? detailsId : undefined}
        onClick={() => {
          if (!open) onOpen()
          setOpen(!open)
        }}
      >
        <ChevronDownIcon aria-hidden className={`size-3.5 transition-transform duration-150 motion-reduce:transition-none ${open ? "rotate-180" : ""}`} />
      </Button>
      <Button variant="primary" size="sm" onClick={() => reloadInto(served)}>
        Reload
      </Button>
    </NoticeBar>
  )
}

/** One build in the list: "#53 · build ed0e266", then one line per merge. */
function NewBuild({ build }: { build: ListedBuild }) {
  const name = build.number === null ? "this build" : `build ${build.number}`
  return (
    <section data-new-build={build.number ?? ""} aria-label={name} className="flex flex-col gap-1.5">
      <h3 className="text-xs font-medium text-muted tabular-nums">
        {build.number === null ? "" : `#${build.number} · `}build {shortCommit(build.commit)}
      </h3>
      {build.changes.length > 0 ? (
        <ul aria-label={`Changes in ${name}`} className="flex flex-col gap-1.5 leading-snug text-ink">
          {build.changes.map((subject, i) => (
            <li key={i}>
              <Linkified text={subject} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">No list of changes for this build.</p>
      )}
    </section>
  )
}
