// The undo window (CEL-191): after Approve or Send back on the Review page, the decision waits a few
// seconds before it is sent, so Lucas can take it back. Whether it's on and how long it is are two
// choices of one setting, kept on this device like the search layout (lib/storage.ts): the nearest
// similar preferences (theme, search layout, panel widths) are device-local too, and the delay is
// the web app's own, so it is not on the board.
import { useStored } from "../lib/storage.ts"

export const UNDO_WINDOW_KEY = "cello:review-undo"

export const DEFAULT_UNDO_SECONDS = 5

/** The lengths Settings offers; storage takes any whole number from 1 to 60. */
export const UNDO_CHOICES = [3, 5, 10, 15, 30] as const

export interface UndoWindow {
  readonly on: boolean
  readonly seconds: number
}

const seconds = (text: string | undefined): number | null => {
  if (text === undefined || !/^\d{1,2}$/.test(text)) return null
  const n = Number(text)
  return n >= 1 && n <= 60 ? n : null
}

/** The saved choice: "10" is on for 10 seconds, "off" is off, "off:10" is off with 10 kept. Unset or unreadable: on, 5 seconds. */
export const readUndoWindow = (stored: string | null): UndoWindow => {
  if (stored === null) return { on: true, seconds: DEFAULT_UNDO_SECONDS }
  if (stored === "off" || stored.startsWith("off:")) return { on: false, seconds: seconds(stored.slice(4)) ?? DEFAULT_UNDO_SECONDS }
  return { on: true, seconds: seconds(stored) ?? DEFAULT_UNDO_SECONDS }
}

export const undoStored = ({ on, seconds }: UndoWindow): string => (on ? String(seconds) : `off:${seconds}`)

/** The window in milliseconds, or null when it's off. */
export const undoWindowMs = ({ on, seconds }: UndoWindow): number | null => (on ? seconds * 1000 : null)

/** The saved setting, re-rendering everything that reads it when Settings changes it. */
export const useUndoWindow = (): UndoWindow => readUndoWindow(useStored(UNDO_WINDOW_KEY))
