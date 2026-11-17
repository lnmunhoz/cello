// Settings → Board (CEL-149), in the desktop app only: the data folder and port the app's own server uses.
// Default ~/.cello on 4747. Another folder (a test board, ~/.cello-release on 4757) gets a server of its own,
// started with the `cello` inside the app, empty like a new user's board. The app's main process keeps the
// choice (board.json in its own state folder) and does the switch; this shows it and asks.
import type { DesktopBoardState } from "@cello/shared/desktopBoard"
import { useEffect, useState } from "react"
import { Button } from "../components/ui/Button.tsx"
import { Input } from "../components/ui/Input.tsx"

/** The app's board, live; null outside the desktop app, or in one from before CEL-149. */
export const useDesktopBoard = (): DesktopBoardState | null => {
  const [state, setState] = useState<DesktopBoardState | null>(null)
  useEffect(() => window.celloDesktop?.board?.onState(setState), [])
  return state
}

const switchBoard = (dataDir: string, port: number) => window.celloDesktop?.board?.command({ kind: "switch", dataDir, port })

/** Keyed by the board in use, so the fields start from it again after a switch. */
export function BoardSettings({ state }: { state: DesktopBoardState }) {
  const [dataDir, setDataDir] = useState(state.dataDir)
  const [port, setPort] = useState(String(state.port))
  const locked = state.setBy.length > 0
  const busy = locked || state.switching
  const changed = dataDir.trim() !== state.dataDir || port.trim() !== String(state.port)
  const onDefault = state.dataDir === state.defaultDataDir && state.port === state.defaultPort
  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-line px-3 py-3"
      data-board-settings
      onSubmit={(e) => {
        e.preventDefault()
        if (!busy && changed) switchBoard(dataDir, Number(port.trim()))
      }}
    >
      <div className="flex items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-[13px]">
          <span className="font-medium">Folder</span>
          <Input
            aria-label="Board folder"
            value={dataDir}
            disabled={busy}
            spellCheck={false}
            onChange={(e) => {
              const next = e.currentTarget.value
              setDataDir(next)
              // Another folder on the default board's port would meet that board's server: suggest its own port.
              if (next.trim() !== state.defaultDataDir && port.trim() === String(state.defaultPort)) setPort(String(state.suggestedPort))
            }}
          />
        </label>
        <label className="flex w-24 shrink-0 flex-col gap-1 text-[13px]">
          <span className="font-medium">Port</span>
          <Input aria-label="Board port" value={port} disabled={busy} inputMode="numeric" onChange={(e) => setPort(e.currentTarget.value)} />
        </label>
      </div>
      <p className="text-[13px] text-muted">
        {locked
          ? `${state.setBy.join(" and ")} set the board for this launch, so it can't be changed here.`
          : "Another folder gets a server of its own on its own port, started with the cello inside this app, and starts empty like a " +
            `new board (a new or empty folder, or another board's). ${state.defaultPort} is ${state.defaultDataDir}'s port. ` +
            "A server this app started for the board you leave stops; nothing in either folder is deleted."}
      </p>
      {state.error ? (
        <p role="alert" className="text-[13px] text-danger">
          {state.error}
        </p>
      ) : null}
      <div className="flex items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={busy || !changed}>
          {state.switching ? "Switching…" : "Switch board"}
        </Button>
        {onDefault || locked ? null : (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => switchBoard(state.defaultDataDir, state.defaultPort)}>
            Back to {state.defaultDataDir} on {state.defaultPort}
          </Button>
        )}
      </div>
    </form>
  )
}
