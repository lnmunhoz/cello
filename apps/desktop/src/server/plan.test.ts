import { describe, expect, it } from "vitest"
import { renderPlist } from "@cello/host/launchAgent"
import { celloCommand, isAlreadyRunning, isBoardTooNew, parseBanner, planServer, serviceFor, serviceInstaller, takenPortMessage } from "./plan.ts"

describe("planServer", () => {
  it("starts the bundled server when nothing answers and no live server holds the data folder", () => {
    expect(planServer({ port: 4747, portAnswers: false, lock: null, service: false, defaultBoard: true })).toEqual({ kind: "start" })
  })

  it("joins the server on the default board's port, ~/.cello on 4747, even without its lock (Lucas's terminal `cello start`)", () => {
    expect(planServer({ port: 4747, portAnswers: true, lock: null, service: false, defaultBoard: true })).toEqual({ kind: "join", url: "http://127.0.0.1:4747" })
  })

  it("CEL-149: never joins a server another board's folder holds: a port that answers without this folder's lock on it is taken", () => {
    // ~/.cello-test typed in Settings on 4747, where the live board's server answers.
    expect(planServer({ port: 4747, portAnswers: true, lock: null, service: false, defaultBoard: false })).toEqual({ kind: "taken", port: 4747 })
    const stale = { pid: 123, port: 4747, alive: false, answers: false }
    expect(planServer({ port: 4747, portAnswers: true, lock: stale, service: false, defaultBoard: false })).toEqual({ kind: "taken", port: 4747 })
  })

  it("CEL-149: joins a board's own server on its port, as before", () => {
    const lock = { pid: 123, port: 4757, alive: true, answers: true }
    expect(planServer({ port: 4757, portAnswers: true, lock, service: false, defaultBoard: false })).toEqual({ kind: "join", url: "http://127.0.0.1:4757" })
  })

  it("CEL-149: waits for this folder's own server rather than join another one on the port", () => {
    const lock = { pid: 123, port: 4800, alive: true, answers: false }
    expect(planServer({ port: 4747, portAnswers: true, lock, service: false, defaultBoard: false })).toEqual({ kind: "wait", url: "http://127.0.0.1:4800", pid: 123 })
  })

  it("says why a port is taken, and what to do", () => {
    expect(takenPortMessage(4747)).toBe("Port 4747 is already used by another Cello board or another program; pick another port for this board.")
  })

  it("starts over a lock left by a dead process: the new server takes it over", () => {
    const lock = { pid: 123, port: 4747, alive: false, answers: false }
    expect(planServer({ port: 4747, portAnswers: false, lock, service: false, defaultBoard: true })).toEqual({ kind: "start" })
  })

  it("joins the server that holds the data folder, on its own port, even when CELLO_PORT differs", () => {
    const lock = { pid: 123, port: 4800, alive: true, answers: true }
    expect(planServer({ port: 4747, portAnswers: true, lock, service: false, defaultBoard: true })).toEqual({ kind: "join", url: "http://127.0.0.1:4800" })
  })

  it("never starts a second server for a held data folder: it waits for the holder to answer", () => {
    const lock = { pid: 123, port: 4800, alive: true, answers: false }
    expect(planServer({ port: 4747, portAnswers: false, lock, service: false, defaultBoard: true })).toEqual({ kind: "wait", url: "http://127.0.0.1:4800", pid: 123 })
  })

  it("waits on CELLO_PORT when the holder hasn't recorded its port yet", () => {
    const lock = { pid: 123, port: 0, alive: true, answers: false }
    expect(planServer({ port: 4747, portAnswers: false, lock, service: false, defaultBoard: true })).toEqual({ kind: "wait", url: "http://127.0.0.1:4747", pid: 123 })
  })
})

describe("planServer with the background service installed (CEL-81)", () => {
  it("joins it when it answers, like any server", () => {
    const lock = { pid: 44568, port: 4747, alive: true, answers: true }
    expect(planServer({ port: 4747, portAnswers: true, lock, service: true, defaultBoard: true })).toEqual({ kind: "join", url: "http://127.0.0.1:4747" })
  })

  it("never starts a server of its own beside it: it asks launchd to start the service and waits for it", () => {
    expect(planServer({ port: 4747, portAnswers: false, lock: null, service: true, defaultBoard: true })).toEqual({ kind: "service", url: "http://127.0.0.1:4747" })
    const stale = { pid: 123, port: 4747, alive: false, answers: false }
    expect(planServer({ port: 4747, portAnswers: false, lock: stale, service: true, defaultBoard: true })).toEqual({ kind: "service", url: "http://127.0.0.1:4747" })
  })
})

describe("serviceFor", () => {
  const plist = renderPlist({
    program: ["/Users/me/cello/apps/cli/dist/cello", "start"],
    home: "/Users/me",
    path: "/usr/bin:/bin",
    dataDir: "/Users/me/.cello",
    port: 4747,
    logPath: "/Users/me/.cello/logs/server.log",
  })

  it("is true for an installed plist that serves this data folder", () => {
    expect(serviceFor(plist, "/Users/me/.cello")).toBe(true)
  })

  it("is false with no plist, a broken one, or one for another data folder", () => {
    expect(serviceFor(null, "/Users/me/.cello")).toBe(false)
    expect(serviceFor("not a plist", "/Users/me/.cello")).toBe(false)
    expect(serviceFor(plist, "/tmp/cello-e2e")).toBe(false)
  })
})

describe("serviceInstaller", () => {
  const exists = (file: string) => file === "/Users/me/.local/bin/cello" || file === "/opt/bin/cello"

  it("installs with the cello Lucas runs: CELLO_BIN, else the one in CELLO_BIN_DIR or ~/.local/bin, else the app's own", () => {
    expect(serviceInstaller({ env: { CELLO_BIN: "/x/cello", HOME: "/Users/me" }, exists, fallback: "/App/Resources/cello" })).toBe("/x/cello")
    expect(serviceInstaller({ env: { HOME: "/Users/me" }, exists, fallback: "/App/Resources/cello" })).toBe("/Users/me/.local/bin/cello")
    expect(serviceInstaller({ env: { HOME: "/Users/me", CELLO_BIN_DIR: "/opt/bin" }, exists, fallback: null })).toBe("/opt/bin/cello")
    expect(serviceInstaller({ env: { HOME: "/Users/other" }, exists, fallback: "/App/Resources/cello" })).toBe("/App/Resources/cello")
    expect(serviceInstaller({ env: { HOME: "/Users/other" }, exists, fallback: null })).toBeNull()
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

  it("recognises the refusal of a board a newer Cello migrated (CEL-149)", () => {
    const refusal = "This board (/Users/x/.cello) was opened by a newer Cello (migration 0028_x); this cello is v0.4.2. Update Cello, or use another board. Nothing was changed."
    expect(isBoardTooNew(refusal)).toBe(true)
    expect(isBoardTooNew("Cello is already running for /Users/x/.cello (pid 9, http://127.0.0.1:4747).")).toBe(false)
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
