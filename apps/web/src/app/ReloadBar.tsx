import { reloadAction, shortCommit, type ReloadAction } from "@cello/shared/build"
import { useAtomRefresh } from "@effect/atom-react"
import { RefreshCwIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { NoticeBar } from "../components/ui/NoticeBar.tsx"
import { loadedBuild, reloadedFor, reloadInto, useServerBuild } from "../lib/build.ts"
import { serverBuildAtom } from "../lib/cello.ts"
import { isEditing } from "../lib/editing.ts"

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

  if (action === "none" || served === null) return null
  return (
    <NoticeBar data-reload-bar={action}>
      <RefreshCwIcon aria-hidden className="size-3.5 text-accent" />
      <span className="font-medium">Cello was updated</span>
      <span className="text-muted">· build {shortCommit(served.commit)}</span>
      {action === "reload" ? <span className="text-muted tabular-nums">· reloading in {Math.max(left, 0)} s</span> : null}
      <Button variant="primary" size="sm" onClick={() => reloadInto(served)}>
        Reload
      </Button>
    </NoticeBar>
  )
}
