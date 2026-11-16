// Keeps the server's log (<dataDir>/logs/server.log, CEL-81) from growing forever: before a server is
// started into it (`cello service install` and `restart`, the desktop app's Keep Running), a log past
// the limit moves to <log>.1, replacing the one there. Two files at most. Node only (not for the web app).
import * as fs from "node:fs"

/** 5 MB: weeks of a server's log. */
export const LOG_LIMIT = 5 * 1024 * 1024

/** Moves `log` to `<log>.1` when it's bigger than `limit` bytes; true when it did. */
export const rotateLog = (log: string, limit = LOG_LIMIT): boolean => {
  try {
    if (fs.statSync(log).size <= limit) return false
  } catch {
    return false
  }
  fs.renameSync(log, `${log}.1`)
  return true
}
