// Where Cello's server keeps its files and where it listens by default, written once. The server (which creates
// the lock), `cello start` and the background service (which read the defaults) and the desktop app (which reads
// the lock and the database to find a board) all use these, so they can't drift apart (CEL-18, after CEL-14 copied
// them into the desktop app). packages/host/src/serverLock.test.ts pins every value.
import * as fs from "node:fs"
import * as path from "node:path"

/** The port `cello start` listens on without CELLO_PORT. */
export const DEFAULT_PORT = 4747
/** The lock a running server keeps in its data folder: its pid and port. One server per data folder. */
export const LOCK_FILE = "server.lock"
/** The database a board keeps in its data folder: a folder with it is a board. */
export const DB_FILE = "cello.db"

/** The data folder `cello start` serves without CELLO_DATA_DIR, under the home folder. */
export const defaultDataDir = (home: string): string => path.join(home, ".cello")

/** Where the server's lock file is, inside its data folder. */
export const lockPath = (dataDir: string): string => path.join(dataDir, LOCK_FILE)

/** Where a running server answers: it only listens on the loopback address. */
export const serverUrl = (port: number): string => `http://127.0.0.1:${port}`

export interface LockInfo {
  readonly pid: number
  /** 0 until the server records the port it bound. */
  readonly port: number
}

/** The pid and port in a lock file's text; null when there is no numeric pid or the text can't be read. */
export const parseLock = (text: string): LockInfo | null => {
  try {
    const info = JSON.parse(text) as Partial<LockInfo>
    return typeof info.pid === "number" ? { pid: info.pid, port: typeof info.port === "number" ? info.port : 0 } : null
  } catch {
    return null
  }
}

/** The pid and port in the lock file at `file`; null when it's missing or names no pid. */
export const readLock = (file: string): LockInfo | null => {
  try {
    return parseLock(fs.readFileSync(file, "utf8"))
  } catch {
    return null
  }
}
