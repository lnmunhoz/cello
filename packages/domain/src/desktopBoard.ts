// Settings → Board in the desktop app (CEL-149): the data folder and port the app's own server uses. The app's
// main process keeps it (apps/desktop/src/server/board.ts, in board.json in the app's state folder, never in a
// board's data folder) and sends this state to the board; the board sends a switch back, which main checks
// field by field here and then again for what the folder and port may be.

/** What the board's Settings shows. */
export interface DesktopBoardState {
  /** The board's data folder the app uses now. */
  readonly dataDir: string
  readonly port: number
  /** ~/.cello and 4747, as `cello start` uses. */
  readonly defaultDataDir: string
  readonly defaultPort: number
  /** The port Settings fills in for a folder other than the default one (4757), so it never takes 4747. */
  readonly suggestedPort: number
  /** The environment variables that set the board for this launch (CELLO_DATA_DIR, CELLO_PORT): Settings can't change it then. */
  readonly setBy: ReadonlyArray<string>
  /** The app is stopping its old server and starting or joining the new one. */
  readonly switching: boolean
  /** Why the last switch was refused (a folder that isn't a full path, a port out of range). */
  readonly error: string | null
}

/** Switch the app to another board: its folder (a full path or one under ~) and port. */
export type DesktopBoardCommand = { readonly kind: "switch"; readonly dataDir: string; readonly port: number }

export const parseDesktopBoardCommand = (value: unknown): DesktopBoardCommand | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (raw["kind"] !== "switch" || typeof raw["dataDir"] !== "string" || typeof raw["port"] !== "number") return null
  return { kind: "switch", dataDir: raw["dataDir"], port: raw["port"] }
}
