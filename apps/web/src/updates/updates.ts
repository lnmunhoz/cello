// Cello.app's updates on the board (CEL-140): the state the desktop app's main process keeps
// (packages/release/src/updates.ts), read through the preload's bridge. In a browser, or a dev build of
// the app (which checks nothing), there's no state and the board shows none of the update UI.
import type { UpdateCommand, UpdateState } from "@cello/release/updates"
import { useEffect, useState } from "react"
import { openInPanel } from "../lib/desktop.ts"

/** The app's update state, live; null outside Cello.app or before the app has sent one. */
export const useUpdateState = (): UpdateState | null => {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => window.celloDesktop?.updates?.onState(setState), [])
  return state
}

export const updateCommand = (command: UpdateCommand): void => window.celloDesktop?.updates?.command(command)

/** The address of one release's notes: the side panel shows it natively (viewer.ts `releaseRef`). */
export const releasePath = (version: string): string => `/releases/${encodeURIComponent(version)}`

/** What's new: the release's notes in the side panel. */
export const openWhatsNew = (version: string): void => {
  openInPanel({ url: releasePath(version), title: `What's new in Cello ${version}` })
}

/** Download's words for the state: the downloaded DMG opens at once, one still downloading shows how far. */
export const downloadLabel = (state: UpdateState): string =>
  state.status === "downloading" && state.progress !== null ? `Downloading… ${Math.round(state.progress * 100)}%` : "Download"
