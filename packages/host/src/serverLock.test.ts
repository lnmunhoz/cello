import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { describe, expect, it } from "vitest"
import { DB_FILE, DEFAULT_PORT, defaultDataDir, LOCK_FILE, lockPath, parseLock, readLock, serverUrl } from "./serverLock.ts"

// These values decide where the human's live board is read from (`cello start`, the desktop app, the background
// service). They are pinned here byte for byte; change one only on purpose, with a migration for existing boards.
describe("the defaults a board is found by", () => {
  it("pins the lock file, the database file, the port and the data folder", () => {
    expect(LOCK_FILE).toBe("server.lock")
    expect(DB_FILE).toBe("cello.db")
    expect(DEFAULT_PORT).toBe(4747)
    expect(defaultDataDir("/Users/lucas")).toBe("/Users/lucas/.cello")
  })

  it("puts the lock file inside the data folder, and the server's address on 127.0.0.1", () => {
    expect(lockPath("/Users/lucas/.cello")).toBe("/Users/lucas/.cello/server.lock")
    expect(serverUrl(4747)).toBe("http://127.0.0.1:4747")
  })
})

describe("parseLock", () => {
  it("reads a pid and a port", () => {
    expect(parseLock(JSON.stringify({ pid: 4242, port: 4747 }))).toEqual({ pid: 4242, port: 4747 })
  })

  it("takes a port that isn't there, or isn't a number, as 0 (the server hasn't recorded it yet)", () => {
    expect(parseLock(JSON.stringify({ pid: 4242 }))).toEqual({ pid: 4242, port: 0 })
    expect(parseLock(JSON.stringify({ pid: 4242, port: "4747" }))).toEqual({ pid: 4242, port: 0 })
  })

  it("is no lock without a numeric pid, or when it can't be read", () => {
    expect(parseLock(JSON.stringify({ port: 4747 }))).toBeNull()
    expect(parseLock(JSON.stringify({ pid: "1" }))).toBeNull()
    expect(parseLock("not json")).toBeNull()
    expect(parseLock("")).toBeNull()
  })
})

describe("readLock", () => {
  it("reads the lock file at a path, and is null for a missing or broken one", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-lock-"))
    expect(readLock(lockPath(dir))).toBeNull()
    fs.writeFileSync(lockPath(dir), JSON.stringify({ pid: 7, port: 4748 }))
    expect(readLock(lockPath(dir))).toEqual({ pid: 7, port: 4748 })
    fs.writeFileSync(lockPath(dir), "{")
    expect(readLock(lockPath(dir))).toBeNull()
  })

  it("is null when a folder stands where the lock file should be", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-lock-"))
    fs.mkdirSync(lockPath(dir))
    expect(readLock(lockPath(dir))).toBeNull()
  })

  it.skipIf(process.getuid?.() === 0)("is null when the lock file can't be read", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-lock-"))
    fs.writeFileSync(lockPath(dir), JSON.stringify({ pid: 7, port: 4748 }), { mode: 0o000 })
    expect(readLock(lockPath(dir))).toBeNull()
  })
})
