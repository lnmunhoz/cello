// Settings → Board (CEL-149): the data folder and port the app's server uses. Default ~/.cello on 4747, the
// board `cello start` serves. Pointed at another folder (a test board, ~/.cello-release on 4757), the app runs
// its own server there with the `cello` inside it, empty like a new user's. Pure: main.ts reads and writes the
// file (board.json in the app's state folder, never in a board's data folder) and carries the switch out.
import * as path from "node:path"
import type { DesktopBoardState } from "@cello/shared/desktopBoard"
import { DEFAULT_PORT } from "./plan.ts"

/** Where the choice is kept, in the app's user data folder. */
export const BOARD_FILE = "board.json"

export interface Board {
  readonly dataDir: string
  readonly port: number
}

export const defaultBoard = (home: string): Board => ({ dataDir: path.join(home, ".cello"), port: DEFAULT_PORT })

const MIN_PORT = 1024
const MAX_PORT = 65535
const validPort = (port: unknown): port is number => typeof port === "number" && Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT

/** The board saved in board.json; null for a missing, broken or wrong file (the app then uses the default). */
export const parseBoardFile = (text: string | null): Board | null => {
  if (!text) return null
  try {
    const raw = JSON.parse(text) as Partial<Record<keyof Board, unknown>> | null
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null
    const { dataDir, port } = raw
    return typeof dataDir === "string" && path.isAbsolute(dataDir) && validPort(port) ? { dataDir: path.resolve(dataDir), port } : null
  } catch {
    return null
  }
}

export const boardFileText = (board: Board): string => `${JSON.stringify({ dataDir: board.dataDir, port: board.port }, null, 2)}\n`

type Env = Readonly<Record<string, string | undefined>>

/**
 * The board the app opens at launch: the saved one, else the default; CELLO_DATA_DIR and CELLO_PORT win over
 * both, each on its own (`bun run dev` and the e2e tests set them), and `setBy` names the ones that did.
 */
export const launchBoard = (options: { readonly env: Env; readonly saved: Board | null; readonly home: string }): { board: Board; setBy: string[] } => {
  const { env } = options
  const base = options.saved ?? defaultBoard(options.home)
  const setBy = (["CELLO_DATA_DIR", "CELLO_PORT"] as const).filter((name) => !!env[name])
  return {
    board: {
      dataDir: env.CELLO_DATA_DIR ? path.resolve(env.CELLO_DATA_DIR) : base.dataDir,
      port: env.CELLO_PORT ? Number(env.CELLO_PORT) : base.port,
    },
    setBy,
  }
}

/** A board typed in Settings, checked: a full path or one under ~ (made absolute), and a port; else why not. */
export const checkBoard = (input: { readonly dataDir: string; readonly port: number }, home: string): Board | string => {
  const typed = input.dataDir.trim()
  if (typed === "") return "Give the board a folder, like ~/.cello-release."
  const expanded = typed === "~" ? home : typed.startsWith("~/") ? path.join(home, typed.slice(2)) : typed
  if (!path.isAbsolute(expanded)) return "The folder needs a full path, like ~/.cello-release or /Users/you/boards/test."
  if (!validPort(input.port)) return `The port is a whole number from ${MIN_PORT} to ${MAX_PORT}, like 4757.`
  return { dataDir: path.resolve(expanded), port: input.port }
}

/** The port a test board gets when it was picked while on 4747. */
const TEST_PORT = DEFAULT_PORT + 10

/**
 * The board for a folder picked when the current board couldn't open (Use Another Board…): the same port for
 * the same folder; another folder leaves 4747, which ~/.cello's server takes whenever it runs, for 4757.
 */
export const otherFolder = (folder: string, current: Board): Board => {
  const dataDir = path.resolve(folder)
  if (dataDir === current.dataDir) return current
  return { dataDir, port: current.port === DEFAULT_PORT ? TEST_PORT : current.port }
}

export const boardState = (options: {
  readonly board: Board
  readonly setBy: ReadonlyArray<string>
  readonly home: string
  readonly switching: boolean
  readonly error: string | null
}): DesktopBoardState => {
  const fallback = defaultBoard(options.home)
  return {
    dataDir: options.board.dataDir,
    port: options.board.port,
    defaultDataDir: fallback.dataDir,
    defaultPort: fallback.port,
    setBy: [...options.setBy],
    switching: options.switching,
    error: options.error,
  }
}
