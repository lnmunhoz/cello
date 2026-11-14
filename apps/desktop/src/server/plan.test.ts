import { describe, expect, it } from "vitest"
import { celloCommand, isAlreadyRunning, parseBanner, parseLock, planServer, serverConfig } from "./plan.ts"

describe("planServer", () => {
  it("starts the bundled server when nothing answers and no live server holds the data folder", () => {
    expect(planServer({ port: 4747, portAnswers: false, lock: null })).toEqual({ kind: "start" })
  })

  it("joins whatever answers on CELLO_PORT (Lucas's terminal `cello start`)", () => {
    expect(planServer({ port: 4747, portAnswers: true, lock: null })).toEqual({ kind: "join", url: "http://127.0.0.1:4747" })
  })

  it("starts over a lock left by a dead process: the new server takes it over", () => {
    const lock = { pid: 123, port: 4747, alive: false, answers: false }
    expect(planServer({ port: 4747, portAnswers: false, lock })).toEqual({ kind: "start" })
  })

  it("joins the server that holds the data folder, on its own port, even when CELLO_PORT differs", () => {
    const lock = { pid: 123, port: 4800, alive: true, answers: true }
    expect(planServer({ port: 4747, portAnswers: true, lock })).toEqual({ kind: "join", url: "http://127.0.0.1:4800" })
  })

  it("never starts a second server for a held data folder: it waits for the holder to answer", () => {
    const lock = { pid: 123, port: 4800, alive: true, answers: false }
    expect(planServer({ port: 4747, portAnswers: false, lock })).toEqual({ kind: "wait", url: "http://127.0.0.1:4800", pid: 123 })
  })

  it("waits on CELLO_PORT when the holder hasn't recorded its port yet", () => {
    const lock = { pid: 123, port: 0, alive: true, answers: false }
    expect(planServer({ port: 4747, portAnswers: false, lock })).toEqual({ kind: "wait", url: "http://127.0.0.1:4747", pid: 123 })
  })
})

describe("server output and lock", () => {
  it("reads the URL from `cello start`'s banner", () => {
    expect(parseBanner("Cello is running at http://127.0.0.1:4791 (data in /tmp/x)\n")).toBe("http://127.0.0.1:4791")
    expect(parseBanner("Cello is runn")).toBeNull()
  })

  it("recognises the refusal to start a second server", () => {
    expect(isAlreadyRunning("Cello is already running for /Users/x/.cello (pid 9, http://127.0.0.1:4747).\n")).toBe(true)
    expect(isAlreadyRunning("Couldn't listen on that port")).toBe(false)
  })

  it("parses the server lock, and ignores a broken one", () => {
    expect(parseLock(JSON.stringify({ pid: 42, port: 4747 }))).toEqual({ pid: 42, port: 4747 })
    expect(parseLock(JSON.stringify({ pid: 42 }))).toEqual({ pid: 42, port: 0 })
    expect(parseLock("{not json")).toBeNull()
    expect(parseLock(JSON.stringify({ port: 4747 }))).toBeNull()
  })
})

describe("serverConfig", () => {
  it("uses 4747 and ~/.cello unless CELLO_PORT and CELLO_DATA_DIR say otherwise", () => {
    expect(serverConfig({ HOME: "/Users/me" })).toEqual({ port: 4747, dataDir: "/Users/me/.cello" })
    expect(serverConfig({ HOME: "/Users/me", CELLO_PORT: "4791", CELLO_DATA_DIR: "/tmp/cello-e2e" })).toEqual({
      port: 4791,
      dataDir: "/tmp/cello-e2e",
    })
  })
})

describe("celloCommand", () => {
  const exists = (file: string) => file === "/repo/apps/cli/dist/cello"

  it("prefers CELLO_BIN, then the binary bundled in the app, then the repo's compiled CLI", () => {
    expect(celloCommand({ env: { CELLO_BIN: "/opt/cello" }, isPackaged: true, resourcesPath: "/App/Resources", repoRoot: "/repo", exists })).toBe("/opt/cello")
    expect(celloCommand({ env: {}, isPackaged: true, resourcesPath: "/App/Resources", repoRoot: "/repo", exists })).toBe("/App/Resources/cello")
    expect(celloCommand({ env: {}, isPackaged: false, resourcesPath: "/x", repoRoot: "/repo", exists })).toBe("/repo/apps/cli/dist/cello")
  })

  it("has none in dev when the CLI isn't built", () => {
    expect(celloCommand({ env: {}, isPackaged: false, resourcesPath: "/x", repoRoot: "/elsewhere", exists })).toBeNull()
  })
})
