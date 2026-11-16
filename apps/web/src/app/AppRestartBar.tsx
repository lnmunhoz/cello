import { RotateCwIcon, XIcon } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { NoticeBar } from "../components/ui/NoticeBar.tsx"
import type { DesktopAppNotice } from "../lib/desktop.ts"

/**
 * In the desktop app, when the app itself should restart (CEL-75): its build on disk changed since it
 * started (the board reloads into a new web build by itself, CEL-37's ReloadBar, but the app around it
 * keeps its old code until it restarts), or it runs from a build folder while /Applications has a copy.
 * Restart quits and reopens it; × hides this notice until the next change.
 */
export function AppRestartBar() {
  const [notice, setNotice] = useState<DesktopAppNotice | null>(null)
  // Kept only in this component's state: reloading the board brings a dismissed notice back.
  const [dismissed, setDismissed] = useState<string | null>(null)
  useEffect(() => window.celloDesktop?.onAppNotice?.(setNotice), [])

  const restart = window.celloDesktop?.restartApp
  if (!notice || !restart || notice.key === dismissed) return null
  return (
    <NoticeBar data-app-restart-bar={notice.kind}>
      <RotateCwIcon aria-hidden className="size-3.5 text-accent" />
      {notice.kind === "updated" ? (
        <>
          <span className="font-medium">The Cello app was updated</span>
          <span className="text-muted">· restart to run the new build</span>
        </>
      ) : (
        <>
          <span className="font-medium">Cello is running from a build folder</span>
          <span className="text-muted">· not /Applications</span>
        </>
      )}
      <Button variant="primary" size="sm" onClick={() => restart()}>
        {notice.kind === "updated" ? "Restart" : "Restart from Applications"}
      </Button>
      <Button variant="ghost" size="icon" aria-label="Later" onClick={() => setDismissed(notice.key)}>
        <XIcon aria-hidden className="size-3.5" />
      </Button>
    </NoticeBar>
  )
}
