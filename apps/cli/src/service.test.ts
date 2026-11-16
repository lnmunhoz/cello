import { describe, expect, it } from "vitest"
import {
  installSteps,
  installText,
  parsePrint,
  refusalText,
  restartSteps,
  selfCommand,
  type ServiceStatus,
  statusText,
  tailLines,
  uninstallSteps,
} from "./service.ts"

describe("launchctl steps", () => {
  it("installs by loading the plist into the user's GUI domain, after clearing a disabled flag", () => {
    expect(installSteps(501, "/Users/me/Library/LaunchAgents/dev.cello.server.plist", { loaded: false })).toEqual([
      { what: "clearing a disabled flag", args: ["enable", "gui/501/dev.cello.server"], optional: true },
      { what: "loading the service", args: ["bootstrap", "gui/501", "/Users/me/Library/LaunchAgents/dev.cello.server.plist"], optional: false },
    ])
  })

  it("unloads the old one first when it's already loaded, so launchd reads the new plist", () => {
    expect(installSteps(501, "/p.plist", { loaded: true })[0]).toEqual({ what: "unloading the old service", args: ["bootout", "gui/501/dev.cello.server"], optional: true })
  })

  it("restarts with kickstart -k (kill, then start again) and uninstalls with bootout", () => {
    expect(restartSteps(501)).toEqual([{ what: "restarting the service", args: ["kickstart", "-k", "gui/501/dev.cello.server"], optional: false }])
    expect(uninstallSteps(501)).toEqual([{ what: "unloading the service", args: ["bootout", "gui/501/dev.cello.server"], optional: true }])
  })
})

describe("parsePrint", () => {
  it("reads the state, pid and last exit code of a running job", () => {
    const text = [
      "gui/501/dev.cello.server = {",
      "\tactive count = 1",
      "\tpath = /Users/me/Library/LaunchAgents/dev.cello.server.plist",
      "\ttype = LaunchAgent",
      "\tstate = running",
      "",
      "\tprogram = /Users/me/cello/apps/cli/dist/cello",
      "\tpid = 44568",
      "\tlast exit code = (never exited)",
      "}",
    ].join("\n")
    expect(parsePrint(text)).toEqual({ running: true, pid: 44568, lastExit: "(never exited)" })
  })

  it("reads a job that isn't running", () => {
    expect(parsePrint("\tstate = not running\n\tlast exit code = 1\n")).toEqual({ running: false, pid: null, lastExit: "1" })
  })
})

describe("selfCommand", () => {
  it("is the binary itself when compiled, and bun with the script from source", () => {
    expect(selfCommand({ execPath: "/Users/me/cello/apps/cli/dist/cello", main: "/$bunfs/root/cello" })).toEqual(["/Users/me/cello/apps/cli/dist/cello"])
    expect(selfCommand({ execPath: "/Users/me/.bun/bin/bun", main: "/Users/me/cello/apps/cli/src/bin.ts" })).toEqual([
      "/Users/me/.bun/bin/bun",
      "/Users/me/cello/apps/cli/src/bin.ts",
    ])
  })
})

describe("tailLines", () => {
  it("keeps the last lines of a log, without the trailing newline", () => {
    expect(tailLines("a\nb\nc\nd\n", 2)).toEqual(["c", "d"])
    expect(tailLines("", 5)).toEqual([])
  })
})

const installed: ServiceStatus = {
  installed: true,
  plist: "/Users/me/Library/LaunchAgents/dev.cello.server.plist",
  program: ["/Users/me/cello/apps/cli/dist/cello", "start"],
  programExists: true,
  dataDir: "/Users/me/.cello",
  port: 4747,
  logPath: "/Users/me/.cello/logs/server.log",
  loaded: true,
  running: true,
  pid: 44568,
  lastExit: "(never exited)",
  server: { version: "0.2.0", commit: "c602f25aa" },
  logTail: ["Cello is running at http://127.0.0.1:4747 (data in /Users/me/.cello)"],
  holder: { pid: 44568, port: 4747 },
}

describe("statusText", () => {
  it("shows an installed, running service: pid, program, data, server version, plist, log and its last lines", () => {
    expect(statusText(installed)).toBe([
      "Background service dev.cello.server: installed, running (pid 44568)",
      "  program  /Users/me/cello/apps/cli/dist/cello start",
      "  data     /Users/me/.cello",
      "  server   http://127.0.0.1:4747 answers: Cello 0.2.0 (build c602f25)",
      "  plist    /Users/me/Library/LaunchAgents/dev.cello.server.plist",
      "  log      /Users/me/.cello/logs/server.log",
      "Last lines of the log:",
      "  Cello is running at http://127.0.0.1:4747 (data in /Users/me/.cello)",
    ].join("\n"))
  })

  it("flags a plist whose program is gone, says how to fix it, and shows a server that doesn't answer", () => {
    const text = statusText({ ...installed, programExists: false, running: false, pid: null, lastExit: "78", server: null, holder: null, logTail: [] })
    expect(text).toBe([
      "Background service dev.cello.server: installed, not running (last exit code 78)",
      "  program  /Users/me/cello/apps/cli/dist/cello start",
      "  data     /Users/me/.cello",
      "  server   http://127.0.0.1:4747 doesn't answer",
      "  plist    /Users/me/Library/LaunchAgents/dev.cello.server.plist",
      "  log      /Users/me/.cello/logs/server.log (empty)",
      "The service's program /Users/me/cello/apps/cli/dist/cello doesn't exist any more (the repo moved, or the build was deleted). " +
        "Build it again, or run `cello service install` with the cello you want the service to run.",
    ].join("\n"))
  })

  it("says when launchd doesn't know the plist", () => {
    expect(statusText({ ...installed, loaded: false, running: false, pid: null, lastExit: null }).split("\n")[0]).toBe(
      "Background service dev.cello.server: installed, but not loaded in launchd (run `cello service install` again to load it)",
    )
  })

  it("says it isn't installed, and names a server running anyway", () => {
    const missing: ServiceStatus = {
      ...installed,
      installed: false,
      program: [],
      programExists: false,
      loaded: false,
      running: false,
      pid: null,
      lastExit: null,
      server: null,
      logTail: [],
    }
    expect(statusText(missing)).toBe([
      "The background service isn't installed: nothing starts Cello at login, or again when it stops.",
      "A server is running for /Users/me/.cello (pid 44568, http://127.0.0.1:4747), started by hand or by the desktop app.",
      "Install the service with `cello service install`.",
    ].join("\n"))
    expect(statusText({ ...missing, holder: null }).split("\n")).toHaveLength(2)
  })
})

describe("refusalText", () => {
  it("names the server holding the data folder, and the two ways on", () => {
    expect(refusalText("/Users/me/.cello", { pid: 123, port: 4747 })).toBe(
      "Cello is already running for /Users/me/.cello (pid 123, http://127.0.0.1:4747), outside the service. " +
        "Stop it first (Ctrl-C in its terminal, or quit the desktop app and pick Stop), or run `cello service install --replace` " +
        "to stop pid 123 and install the service in its place.",
    )
  })
})

describe("installText", () => {
  it("says what runs, where its data and log are, and how to check it", () => {
    expect(installText({
      plist: "/Users/me/Library/LaunchAgents/dev.cello.server.plist",
      program: ["/Users/me/cello/apps/cli/dist/cello", "start"],
      dataDir: "/Users/me/.cello",
      port: 4747,
      logPath: "/Users/me/.cello/logs/server.log",
      replaced: null,
      previous: null,
    })).toBe([
      "Installed the background service dev.cello.server: it runs `/Users/me/cello/apps/cli/dist/cello start` now, at every login, and again whenever it stops.",
      "  data    /Users/me/.cello",
      "  server  http://127.0.0.1:4747",
      "  plist   /Users/me/Library/LaunchAgents/dev.cello.server.plist",
      "  log     /Users/me/.cello/logs/server.log",
      "Check it with `cello service status`. After rebuilding cello, `cello service restart` runs the new build.",
    ].join("\n"))
  })

  it("says which server it stopped and which plist it replaced", () => {
    const text = installText({
      plist: "/p.plist",
      program: ["/c", "start"],
      dataDir: "/d",
      port: 4747,
      logPath: "/d/logs/server.log",
      replaced: 123,
      previous: { program: ["/old/cello", "start"], dataDir: "/old" },
    })
    expect(text).toContain("Stopped the server that held /d (pid 123).")
    expect(text).toContain("It replaces the service that ran `/old/cello start` for /old.")
  })
})
