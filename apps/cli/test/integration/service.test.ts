// `cello service install | status | restart | uninstall` (CEL-81) against a temp HOME and a fake
// `launchctl` on PATH, so a test never writes to the real ~/Library/LaunchAgents or reaches launchd.
// The fake (../fakeLaunchctl.ts) keeps launchd's state in files.
import * as fs from "node:fs"
import * as path from "node:path"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { LOCK_FILE } from "@cello/server/server/ServerLock"
import { isAlive } from "@cello/server/process/isAlive"
import { plistPath, renderPlist, servicePathVariable } from "@cello/shared/launchAgent"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { installText, refusalText } from "../../src/service.ts"
import { writeFakeLaunchctl } from "../fakeLaunchctl.ts"
import { cello } from "./cli.ts"

const UID = process.getuid!()
const TARGET = `gui/${UID}/dev.cello.server`

/** A process standing in for a server (or the service's job); killed when the test ends. */
const sleeper = Effect.acquireRelease(
  Effect.sync(() => Bun.spawn(["sleep", "300"])),
  (proc) => Effect.promise(async () => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL")
    await proc.exited
  }),
)

const setup = (options: { readonly port?: number } = {}) =>
  Effect.gen(function* () {
    const dir = yield* tempDataDir
    const home = path.join(dir, "home")
    const dataDir = path.join(dir, "data")
    const bin = path.join(dir, "bin")
    const state = path.join(dir, "launchd")
    fs.mkdirSync(home)
    const { calls } = writeFakeLaunchctl(bin, state, UID)
    // The `cello` this command "is": a build folder of its own, as apps/cli/dist would be.
    const program = path.join(dir, "build", "cello")
    fs.mkdirSync(path.dirname(program))
    fs.writeFileSync(program, "#!/bin/sh\n", { mode: 0o755 })
    const port = options.port ?? 1 // nothing answers on port 1
    const env = { HOME: home, PATH: bin, CELLO_DATA_DIR: dataDir, CELLO_PORT: String(port) }
    const run = (...args: string[]) => cello({ port, cwd: dir, env, self: [program] })(...args)
    const plist = plistPath(home)
    const logPath = path.join(dataDir, "logs", "server.log")
    /** As if launchd started the job: loaded, with `pid` as its process. */
    const loadJob = (pid: number) => {
      fs.writeFileSync(path.join(state, "loaded"), "")
      fs.writeFileSync(path.join(state, "pid"), String(pid))
    }
    return { dir, home, dataDir, bin, state, program, port, env, run, calls, plist, logPath, loadJob }
  })

describe("cello service install", () => {
  it.live("writes the launch agent into HOME's LaunchAgents and loads it; the plist runs this cello's `start` with its data folder and port", () =>
    Effect.gen(function* () {
      const { dir, home, dataDir, program, bin, run, calls, plist, logPath } = yield* setup()

      const installed = yield* run("service", "install")

      expect(installed.failure).toBeNull()
      expect(plist.startsWith(dir)).toBe(true)
      expect(fs.readFileSync(plist, "utf8")).toBe(renderPlist({
        program: [program, "start"],
        home,
        path: servicePathVariable(program, bin),
        dataDir,
        port: 1,
        logPath,
      }))
      expect(fs.statSync(path.dirname(logPath)).isDirectory()).toBe(true)
      expect(calls()).toEqual([`enable ${TARGET}`, `bootstrap gui/${UID} ${plist}`])
      expect(installed.out).toBe(installText({ plist, program: [program, "start"], dataDir, port: 1, logPath, replaced: null, previous: null }))
    }).pipe(Effect.scoped))

  it.live("refuses a data folder another server holds, saying why; --replace stops that pid, and only that one", () =>
    Effect.gen(function* () {
      const { dataDir, run, calls, plist } = yield* setup()
      const server = yield* sleeper
      const bystander = yield* sleeper
      fs.mkdirSync(dataDir, { recursive: true })
      fs.writeFileSync(path.join(dataDir, LOCK_FILE), JSON.stringify({ pid: server.pid, port: 4791 }))

      const refused = yield* run("service", "install")
      expect(refused.failure).toBe(refusalText(dataDir, { pid: server.pid, port: 4791 }))
      expect(fs.existsSync(plist)).toBe(false)
      expect(calls()).toEqual([])

      const replaced = yield* run("service", "install", "--replace")
      expect(replaced.failure).toBeNull()
      expect(replaced.out.split("\n")[0]).toBe(`Stopped the server that held ${dataDir} (pid ${server.pid}).`)
      expect(yield* Effect.promise(() => server.exited)).not.toBe(0)
      expect(isAlive(bystander.pid)).toBe(true)
      expect(fs.existsSync(plist)).toBe(true)
    }).pipe(Effect.scoped))

  it.live("never stops itself: a lock naming this very process is refused even with --replace", () =>
    Effect.gen(function* () {
      const { dataDir, run } = yield* setup()
      fs.mkdirSync(dataDir, { recursive: true })
      fs.writeFileSync(path.join(dataDir, LOCK_FILE), JSON.stringify({ pid: process.pid, port: 4791 }))
      const refused = yield* run("service", "install", "--replace")
      expect(refused.failure).toBe(`The server holding ${dataDir} is this very process (pid ${process.pid}); stop it another way.`)
    }).pipe(Effect.scoped))

  it.live("installing again unloads the running service first (its server isn't 'another server'), then loads the new plist", () =>
    Effect.gen(function* () {
      const { dataDir, run, calls, plist, loadJob, program } = yield* setup()
      expect((yield* run("service", "install")).failure).toBeNull()
      const job = yield* sleeper
      loadJob(job.pid)
      fs.writeFileSync(path.join(dataDir, LOCK_FILE), JSON.stringify({ pid: job.pid, port: 1 }))

      const again = yield* run("service", "install")

      expect(again.failure).toBeNull()
      expect(again.out).toContain(`It replaces the service that ran \`${program} start\` for ${dataDir}.`)
      expect(calls().slice(2)).toEqual([`print ${TARGET}`, `bootout ${TARGET}`, `enable ${TARGET}`, `bootstrap gui/${UID} ${plist}`])
      expect(yield* Effect.promise(() => job.exited)).not.toBe(0)
    }).pipe(Effect.scoped))

  it.live("says plainly when launchctl isn't there (not macOS), before changing anything", () =>
    Effect.gen(function* () {
      const { dir, env, program, plist } = yield* setup()
      const run = cello({ port: 1, cwd: dir, env: { ...env, PATH: path.join(dir, "nowhere") }, self: [program] })
      expect((yield* run("service", "install")).failure).toBe(
        "`cello service` runs Cello as a macOS launchd service, and launchctl isn't on the PATH. On other systems, run `cello start` yourself.",
      )
      expect(fs.existsSync(plist)).toBe(false)
    }).pipe(Effect.scoped))

  it.live("fails with launchctl's own words when loading fails", () =>
    Effect.gen(function* () {
      const { run, state } = yield* setup()
      fs.writeFileSync(path.join(state, "bootstrap-fails"), "")
      expect((yield* run("service", "install")).failure).toBe(
        "launchctl couldn't do it (loading the service): Bootstrap failed: 5: Input/output error",
      )
    }).pipe(Effect.scoped))
})

describe("cello service status", () => {
  it.live("before install: not installed, and names a server running anyway", () =>
    Effect.gen(function* () {
      const { dataDir, run } = yield* setup()
      const server = yield* sleeper
      fs.mkdirSync(dataDir, { recursive: true })
      fs.writeFileSync(path.join(dataDir, LOCK_FILE), JSON.stringify({ pid: server.pid, port: 4791 }))
      expect((yield* run("service", "status")).out).toBe([
        "The background service isn't installed: nothing starts Cello at login, or again when it stops.",
        `A server is running for ${dataDir} (pid ${server.pid}, http://127.0.0.1:4791), started by hand or by the desktop app.`,
        "Install the service with `cello service install`.",
      ].join("\n"))
    }).pipe(Effect.scoped))

  it.live("installed and running: its pid, the server's version, and the log's last lines", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const dataDir = path.join(dir, "served")
      const { port } = yield* startServer(dataDir)
      const { run, loadJob, logPath, plist, program } = yield* setup({ port })
      expect((yield* run("service", "install")).failure).toBeNull()
      loadJob(4242)
      fs.writeFileSync(logPath, [...Array.from({ length: 12 }, (_, i) => `line ${i + 1}`), ""].join("\n"))

      const status = yield* run("service", "status")
      const lines = status.out.split("\n")
      expect(lines[0]).toBe("Background service dev.cello.server: installed, running (pid 4242)")
      expect(lines).toContain(`  program  ${program} start`)
      expect(lines.find((l) => l.startsWith("  server"))).toMatch(new RegExp(`^  server   http://127\\.0\\.0\\.1:${port} answers: Cello \\S+ \\(build \\w+\\)$`))
      expect(lines).toContain(`  plist    ${plist}`)
      expect(lines.slice(-11)).toEqual(["Last lines of the log:", ...Array.from({ length: 10 }, (_, i) => `  line ${i + 3}`)])

      const json = JSON.parse((yield* run("service", "status", "--json")).out)
      expect(json).toMatchObject({ installed: true, loaded: true, running: true, pid: 4242, port, programExists: true, plist })
      expect(json.server.version).toEqual(expect.any(String))
    }).pipe(Effect.scoped))

  it.live("flags a plist whose program no longer exists", () =>
    Effect.gen(function* () {
      const { run, program } = yield* setup()
      expect((yield* run("service", "install")).failure).toBeNull()
      fs.rmSync(program)
      const status = yield* run("service", "status")
      expect(status.out.split("\n")[0]).toBe("Background service dev.cello.server: installed, not running (last exit code 78: EX_CONFIG)")
      expect(status.out).toContain(`The service's program ${program} doesn't exist any more`)
    }).pipe(Effect.scoped))
})

describe("cello service restart", () => {
  it.live("kickstarts the service with -k, so launchd runs the binary afresh", () =>
    Effect.gen(function* () {
      const { run, calls, loadJob, program } = yield* setup()
      expect((yield* run("service", "install")).failure).toBeNull()
      const job = yield* sleeper
      loadJob(job.pid)

      const restarted = yield* run("service", "restart")

      expect(restarted.failure).toBeNull()
      expect(calls().at(-1)).toBe(`kickstart -k ${TARGET}`)
      expect(yield* Effect.promise(() => job.exited)).not.toBe(0)
      expect(restarted.out).toBe(`Restarted the background service: launchd runs \`${program} start\` again, so a rebuilt cello takes over now.`)
    }).pipe(Effect.scoped))

  it.live("refuses when the service isn't installed, or its program is gone", () =>
    Effect.gen(function* () {
      const { run, program } = yield* setup()
      expect((yield* run("service", "restart")).failure).toBe("The background service isn't installed. Install it with `cello service install`.")
      expect((yield* run("service", "install")).failure).toBeNull()
      fs.rmSync(program)
      expect((yield* run("service", "restart")).failure).toContain(`The service's program ${program} doesn't exist any more`)
    }).pipe(Effect.scoped))
})

describe("cello service uninstall", () => {
  it.live("unloads the service (stopping its server) and deletes the plist; the data folder and log stay", () =>
    Effect.gen(function* () {
      const { run, calls, loadJob, plist, dataDir, logPath } = yield* setup()
      expect((yield* run("service", "install")).failure).toBeNull()
      const job = yield* sleeper
      loadJob(job.pid)
      fs.writeFileSync(path.join(dataDir, "cello.db"), "data")
      fs.writeFileSync(logPath, "Cello is running\n")

      const removed = yield* run("service", "uninstall")

      expect(removed.failure).toBeNull()
      expect(calls().slice(-2)).toEqual([`print ${TARGET}`, `bootout ${TARGET}`])
      expect(yield* Effect.promise(() => job.exited)).not.toBe(0)
      expect(fs.existsSync(plist)).toBe(false)
      expect(fs.readFileSync(path.join(dataDir, "cello.db"), "utf8")).toBe("data")
      expect(removed.out).toBe([
        "Removed the background service: its server stopped, and nothing starts Cello at login any more.",
        `Your data in ${dataDir} is untouched; the log stays in ${logPath}.`,
        "Run `cello start` (or open the desktop app) to use Cello without the service.",
      ].join("\n"))
    }).pipe(Effect.scoped))

  it.live("says there's nothing to remove when it isn't installed", () =>
    Effect.gen(function* () {
      const { run, calls } = yield* setup()
      const removed = yield* run("service", "uninstall")
      expect(removed).toEqual({ out: "The background service isn't installed; nothing to remove.", failure: null })
      expect(calls()).toEqual([])
    }).pipe(Effect.scoped))
})
