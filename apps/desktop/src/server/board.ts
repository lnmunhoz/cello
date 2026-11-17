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

/** The default board, ~/.cello on 4747: the only one that joins a server on its port without its folder's lock there. */
export const isDefaultBoard = (board: Board, home: string): boolean => {
  const fallback = defaultBoard(home)
  return board.dataDir === fallback.dataDir && board.port === fallback.port
}

/** The port suggested for a board in another folder, so it never takes 4747 from ~/.cello's server. */
export const SUGGESTED_PORT = DEFAULT_PORT + 10

const MIN_PORT = 1024
const MAX_PORT = 65535
const validPort = (port: unknown): port is number => typeof port === "number" && Number.isInteger(port) && port >= MIN_PORT && port <= MAX_PORT

export type SavedBoard =
  | { readonly kind: "none" }
  | { readonly kind: "board"; readonly board: Board }
  /** The file is there but can't be used (cut off, edited by hand): the app asks instead of opening the default. */
  | { readonly kind: "unreadable"; readonly problem: string }

/** What board.json (its text, null when there's no file) says; `file` names it in the problem. */
export const readBoardFile = (text: string | null, file: string): SavedBoard => {
  if (text === null) return { kind: "none" }
  const unreadable: SavedBoard = {
    kind: "unreadable",
    problem: `The board setting in ${file} can't be read, so the app didn't open any board. Use the default board (~/.cello on 4747), or pick another.`,
  }
  try {
    const raw = JSON.parse(text) as Partial<Record<keyof Board, unknown>> | null
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return unreadable
    const { dataDir, port } = raw
    return typeof dataDir === "string" && path.isAbsolute(dataDir) && validPort(port) ? { kind: "board", board: { dataDir: path.resolve(dataDir), port } } : unreadable
  } catch {
    return unreadable
  }
}

export const boardFileText = (board: Board): string => `${JSON.stringify({ dataDir: board.dataDir, port: board.port }, null, 2)}\n`

type Env = Readonly<Record<string, string | undefined>>

/**
 * The board the app opens at launch: the saved one, else the default; CELLO_DATA_DIR and CELLO_PORT win over
 * both, each on its own (`bun run dev` and the e2e tests set them), and `setBy` names the ones that did.
 * `problem` says why the app can't open any board yet: board.json is there but unreadable, or CELLO_PORT isn't
 * a port. The app then asks what to do instead of opening one.
 */
export const launchBoard = (options: { readonly env: Env; readonly saved: SavedBoard; readonly home: string }): {
  board: Board
  setBy: string[]
  problem: string | null
} => {
  const { env } = options
  const base = options.saved.kind === "board" ? options.saved.board : defaultBoard(options.home)
  const setBy = (["CELLO_DATA_DIR", "CELLO_PORT"] as const).filter((name) => !!env[name])
  const envPort = env.CELLO_PORT ? Number(env.CELLO_PORT) : null
  const badPort = env.CELLO_PORT && !validPort(envPort) ? `CELLO_PORT is "${env.CELLO_PORT}", but a port is a whole number from ${MIN_PORT} to ${MAX_PORT}.` : null
  const fileProblem = options.saved.kind === "unreadable" && setBy.length < 2 ? options.saved.problem : null
  return {
    board: {
      dataDir: env.CELLO_DATA_DIR ? path.resolve(env.CELLO_DATA_DIR) : base.dataDir,
      port: envPort !== null && badPort === null ? envPort : base.port,
    },
    setBy,
    problem: badPort ?? fileProblem,
  }
}

/** What's in a folder a board would use: nothing yet, an empty folder, a board (it has cello.db), or other files. */
export type FolderKind = "missing" | "empty" | "board" | "other"

/**
 * A board typed in Settings (or picked in Finder), checked: a full path or one under ~ (made absolute), never /
 * or the home folder itself, never a folder of other files; and a port. Else why not.
 */
export const checkBoard = (
  input: { readonly dataDir: string; readonly port: number },
  home: string,
  folderKind: (dir: string) => FolderKind,
): Board | string => {
  const typed = input.dataDir.trim()
  if (typed === "") return "Give the board a folder, like ~/.cello-release."
  const expanded = typed === "~" ? home : typed.startsWith("~/") ? path.join(home, typed.slice(2)) : typed
  if (!path.isAbsolute(expanded)) return "The folder needs a full path, like ~/.cello-release or /Users/you/boards/test."
  const dataDir = path.resolve(expanded)
  if (dataDir === path.parse(dataDir).root || dataDir === path.resolve(home)) {
    return `A board needs a folder of its own, like ~/.cello-release, not ${dataDir}.`
  }
  if (folderKind(dataDir) === "other") {
    return `${dataDir} already holds other files and isn't a Cello board (no cello.db). Pick a new or empty folder, or another board's.`
  }
  if (!validPort(input.port)) return `The port is a whole number from ${MIN_PORT} to ${MAX_PORT}, like ${SUGGESTED_PORT}.`
  return { dataDir, port: input.port }
}

/**
 * The board for a folder picked when the current board couldn't open (Use Another Board…): the same port for
 * the same folder; another folder leaves 4747, which ~/.cello's server takes whenever it runs, for 4757.
 */
export const otherFolder = (folder: string, current: Board): Board => {
  const dataDir = path.resolve(folder)
  if (dataDir === current.dataDir) return current
  return { dataDir, port: current.port === DEFAULT_PORT ? SUGGESTED_PORT : current.port }
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
    suggestedPort: SUGGESTED_PORT,
    setBy: [...options.setBy],
    switching: options.switching,
    error: options.error,
  }
}
