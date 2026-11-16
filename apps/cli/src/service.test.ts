import { describe, expect, it } from "vitest"
import {
  failedInstallText,
  installSteps,
  installText,
  isTemporaryPath,
  refusalText,
  restartSteps,
  sameService,
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

  it("restarts a running server with SIGTERM through launchd (never kickstart -k, which may SIGKILL), and starts a stopped one", () => {
    expect(restartSteps(501, { running: true })).toEqual([
      { what: "stopping the service's server", args: ["kill", "SIGTERM", "gui/501/dev.cello.server"], optional: false },
    ])
    expect(restartSteps(501, { running: false })).toEqual([{ what: "starting the service", args: ["kickstart", "gui/501/dev.cello.server"], optional: false }])
  })

  it("uninstalls with bootout", () => {
    expect(uninstallSteps(501)).toEqual([{ what: "unloading the service", args: ["bootout", "gui/501/dev.cello.server"], optional: true }])
  })
})

describe("isTemporaryPath", () => {
  const temp = ["/private/var/folders/xy/T", "/tmp", "/private/tmp"]

  it("is true in a temp folder or a git worktree", () => {
    expect(isTemporaryPath("/private/var/folders/xy/T/cello-1/cello", temp)).toBe(true)
    expect(isTemporaryPath("/tmp/cello", temp)).toBe(true)
    expect(isTemporaryPath("/Users/me/cello/.claude/worktrees/agent-1/apps/cli/dist/cello", temp)).toBe(true)
  })

  it("is false for the repo's build or ~/.local/bin, and for a folder that only starts like a temp one", () => {
    expect(isTemporaryPath("/Users/me/cello/apps/cli/dist/cello", temp)).toBe(false)
    expect(isTemporaryPath("/tmpfiles/cello", temp)).toBe(false)
  })
})

describe("sameService", () => {
  const installed = { program: ["/c/cello", "start"], dataDir: "/d", port: 4747 }

  it("is the same only when the program, data folder and port all match", () => {
    expect(sameService(installed, { ...installed })).toBe(true)
    expect(sameService(installed, { ...installed, dataDir: "/other" })).toBe(false)
    expect(sameService(installed, { ...installed, port: 4800 })).toBe(false)
    expect(sameService(installed, { ...installed, program: ["/elsewhere/cello", "start"] })).toBe(false)
  })
})

describe("failedInstallText", () => {
  const reason = "Bootstrap failed: 5: Input/output error"

  it("says nothing changed when no server was stopped and there was no old service", () => {
    expect(failedInstallText({ reason, dataDir: "/d", stopped: false, restored: null })).toBe(
      `launchctl couldn't load the service: ${reason} Nothing was changed; \`cello service status\` shows the state.`,
    )
  })

  it("says the server was stopped and how to bring Cello back when the old service didn't come back", () => {
    expect(failedInstallText({ reason, dataDir: "/d", stopped: true, restored: "not loaded" })).toBe(
      `launchctl couldn't load the service: ${reason} The old service's plist is back in place, but launchd didn't load it either. ` +
        "The server for /d was stopped. Run `cello start` to use Cello now; `cello service status` and the log say why the service didn't load.",
    )
    expect(failedInstallText({ reason, dataDir: "/d", stopped: true, restored: null })).toContain("The server for /d was stopped.")
  })

  it("says the old service runs again when it does", () => {
    expect(failedInstallText({ reason, dataDir: "/d", stopped: true, restored: "loaded" })).toBe(
      `launchctl couldn't load the service: ${reason} The old service's plist is back in place and running again.`,
    )
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
