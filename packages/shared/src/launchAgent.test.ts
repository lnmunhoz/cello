import { describe, expect, it } from "vitest"
import { parsePlist, parsePrint, plistPath, renderPlist, SERVICE_LABEL, serviceLogPath, servicePathVariable, type ServiceSpec } from "./launchAgent.ts"

const spec: ServiceSpec = {
  program: ["/Users/me/cello/apps/cli/dist/cello", "start"],
  home: "/Users/me",
  path: "/Users/me/cello/apps/cli/dist:/opt/homebrew/bin:/usr/bin:/bin",
  dataDir: "/Users/me/.cello",
  port: 4747,
  logPath: "/Users/me/.cello/logs/server.log",
}

describe("where the service lives", () => {
  it("is the user agent dev.cello.server, its plist in ~/Library/LaunchAgents, its log in the data folder", () => {
    expect(SERVICE_LABEL).toBe("dev.cello.server")
    expect(plistPath("/Users/me")).toBe("/Users/me/Library/LaunchAgents/dev.cello.server.plist")
    expect(serviceLogPath("/Users/me/.cello")).toBe("/Users/me/.cello/logs/server.log")
  })
})

describe("renderPlist", () => {
  it("starts `cello start` at login, keeps it alive, and spells out the environment launchd won't give it", () => {
    expect(renderPlist(spec)).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>dev.cello.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/me/cello/apps/cli/dist/cello</string>
    <string>start</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/Users/me/cello/apps/cli/dist:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>/Users/me</string>
    <key>CELLO_DATA_DIR</key>
    <string>/Users/me/.cello</string>
    <key>CELLO_PORT</key>
    <string>4747</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>/Users/me</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>5</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>/Users/me/.cello/logs/server.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/me/.cello/logs/server.log</string>
</dict>
</plist>
`)
  })

  it("escapes XML in paths", () => {
    const xml = renderPlist({ ...spec, program: ["/Users/me/R&D <x>/cello", "start"] })
    expect(xml).toContain("<string>/Users/me/R&amp;D &lt;x&gt;/cello</string>")
  })
})

describe("parsePlist", () => {
  it("reads back what renderPlist wrote", () => {
    expect(parsePlist(renderPlist(spec))).toEqual({
      label: "dev.cello.server",
      program: ["/Users/me/cello/apps/cli/dist/cello", "start"],
      dataDir: "/Users/me/.cello",
      port: 4747,
      logPath: "/Users/me/.cello/logs/server.log",
    })
  })

  it("unescapes XML, and leaves out what the plist doesn't say", () => {
    const xml = renderPlist({ ...spec, program: ["/R&D/cello", "start"] })
      .replace(/\s*<key>CELLO_PORT<\/key>\s*<string>4747<\/string>/, "")
      .replace(/\s*<key>StandardOutPath<\/key>\s*<string>[^<]*<\/string>/, "")
    expect(parsePlist(xml)).toEqual({ label: "dev.cello.server", program: ["/R&D/cello", "start"], dataDir: "/Users/me/.cello", port: null, logPath: null })
  })

  it("is null for a file that isn't a plist with a program", () => {
    expect(parsePlist("")).toBeNull()
    expect(parsePlist("<plist><dict><key>Label</key><string>x</string></dict></plist>")).toBeNull()
  })
})

describe("servicePathVariable", () => {
  it("puts the program's folder first, keeps the installer's PATH, adds the usual folders, once each", () => {
    expect(servicePathVariable("/Users/me/cello/apps/cli/dist/cello", "/Users/me/.bun/bin:/usr/bin:/bin")).toBe(
      "/Users/me/cello/apps/cli/dist:/Users/me/.bun/bin:/usr/bin:/bin:/opt/homebrew/bin:/usr/local/bin:/usr/sbin:/sbin",
    )
  })

  it("drops empty entries and ones a plist can't hold", () => {
    expect(servicePathVariable("/x/cello", "::/ok:/bad\u0001dir")).toBe("/x:/ok:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
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

