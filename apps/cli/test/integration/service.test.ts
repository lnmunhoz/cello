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
import {
  failedInstallText,
  installText,
  invalidLockText,
  otherServiceText,
  refusalText,
  restartTimeoutText,
  staleLockText,
  staleProgram,
  temporaryText,
} from "../../src/service.ts"
import { fakeJobPid, writeFakeLaunchctl } from "../fakeLaunchctl.ts"
import { LSOF_PATHS } from "../../src/launchd.ts"
import { cello, startProcess, UNDER_LOAD } from "./cli.ts"

const UID = process.getuid!()
/** lsof, which tells who listens on a port; the reused-pid test needs it (as install does to be sure). */
const lsof = LSOF_PATHS.find((file) => fs.existsSync(file))
const TARGET = `gui/${UID}/dev.cello.server`

/** A process standing in for a server (or the service's job); killed when the test ends. */
const sleeper = Effect.acquireRelease(
  Effect.sync(() => Bun.spawn(["sleep", "300"])),
  (proc) => Effect.promise(async () => {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL")
    await proc.exited
  }),
)

const setup = (options: { readonly port?: number; readonly env?: Record<string, string> } = {}) =>
  Effect.gen(function* () {
    const dir = yield* tempDataDir
    const home = path.join(dir, "home")
    const dataDir = path.join(dir, "data")
    const bin = path.join(dir, "bin")
    const state = path.join(dir, "launchd")
    fs.mkdirSync(home)
    const { calls } = writeFakeLaunchctl(bin, state, UID)
    // A job the fake started (respawn) is killed, by its pid, when the test ends.
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        const pid = fakeJobPid(state)
        if (pid !== null && pid > 1 && isAlive(pid)) process.kill(pid, "SIGKILL")
      })
    )
    // The `cello` this command "is": a build folder of its own, as apps/cli/dist would be. It sits in
    // a temp folder, so installs pass --temporary.
    const program = path.join(dir, "build", "cello")
    fs.mkdirSync(path.dirname(program))
    fs.writeFileSync(program, "#!/bin/sh\n", { mode: 0o755 })
    const port = options.port ?? 1 // nothing answers on port 1
    const env = { HOME: home, PATH: bin, CELLO_DATA_DIR: dataDir, CELLO_PORT: String(port), ...options.env }
    const runWith = (extra: Record<string, string>) => (...args: string[]) =>
      cello({ port, cwd: dir, env: { ...env, ...extra }, self: [program] })(...args)
    const run = runWith({})
    const install = (...flags: string[]) => run("service", "install", "--temporary", ...flags)
    const plist = plistPath(home)
    const logPath = path.join(dataDir, "logs", "server.log")
    /** As if launchd started the job: loaded, with `pid` as its process. */
    const loadJob = (pid: number) => {
      fs.writeFileSync(path.join(state, "loaded"), "")
      fs.writeFileSync(path.join(state, "pid"), String(pid))
    }
    const writeLock = (pid: number, lockPort: number) => {
      fs.mkdirSync(dataDir, { recursive: true })
      fs.writeFileSync(path.join(dataDir, LOCK_FILE), JSON.stringify({ pid, port: lockPort }))
    }
    return { dir, home, dataDir, bin, state, program, port, env, run, runWith, install, calls, plist, logPath, loadJob, writeLock }
  })

describe("cello service install", () => {
  it.live("writes the launch agent into HOME's LaunchAgents and loads it; the plist runs this cello's `start` with its data folder and port", () =>
    Effect.gen(function* () {
      const { dir, home, dataDir, program, bin, install, calls, plist, logPath } = yield* setup()

      const installed = yield* install()

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

  it.live("won't install a cello from a temp folder or a git worktree, which can disappear, unless --temporary", () =>
    Effect.gen(function* () {
      const { run, program, plist, calls } = yield* setup()
      expect((yield* run("service", "install")).failure).toBe(temporaryText(program))
      expect(fs.existsSync(plist)).toBe(false)
      expect(calls()).toEqual([])
    }).pipe(Effect.scoped))

  it.live("refuses a CELLO_PORT that isn't a port, and a HOME that isn't an absolute path", () =>
    Effect.gen(function* () {
      const { runWith, plist } = yield* setup()
      expect((yield* runWith({ CELLO_PORT: "abc" })("service", "install", "--temporary")).failure).toBe(
        "CELLO_PORT is \"abc\", which isn't a port (1 to 65535), so the service couldn't listen on it.",
      )
      expect((yield* runWith({ HOME: "home" })("service", "install", "--temporary")).failure).toBe(
        "HOME is \"home\", which isn't an absolute path, so there's no LaunchAgents folder to put the service in.",
      )
      expect(fs.existsSync(plist)).toBe(false)
    }).pipe(Effect.scoped))

  // UNDER_LOAD: the process is the point. A `cello start` process, then stopping it: 1.1 s idle, 5.3 s at load ~110.
  it.live("refuses while a Cello server started another way holds the data folder; --replace stops that server, and only it", () =>
    Effect.gen(function* () {
      const { dataDir, install, plist } = yield* setup()
      const { proc, port } = yield* startProcess(dataDir)
      const bystander = yield* sleeper

      const refused = yield* install()
      expect(refused.failure).toBe(refusalText(dataDir, { pid: proc.pid, port }))
      expect(fs.existsSync(plist)).toBe(false)

      const replaced = yield* install("--replace")
      expect(replaced.failure).toBeNull()
      expect(replaced.out.split("\n")[0]).toBe(`Stopped the server that held ${dataDir} (pid ${proc.pid}).`)
      yield* Effect.promise(() => proc.exited)
      expect(isAlive(bystander.pid)).toBe(true)
      expect(fs.existsSync(plist)).toBe(true)
    }).pipe(Effect.scoped), UNDER_LOAD)

  it.live("never stops a process that isn't a Cello server: a lock whose pid is alive but nothing answers is stale, even with --replace", () =>
    Effect.gen(function* () {
      const { dataDir, install, writeLock, plist } = yield* setup()
      const reused = yield* sleeper // a stale lock's pid, since taken by another program
      writeLock(reused.pid, 1)

      for (const flags of [[], ["--replace"]]) {
        expect((yield* install(...flags)).failure).toBe(staleLockText(dataDir, { pid: reused.pid, port: 1 }))
      }
      expect(isAlive(reused.pid)).toBe(true)
      expect(fs.existsSync(plist)).toBe(false)
    }).pipe(Effect.scoped))

  it.live.skipIf(lsof === undefined)(
    "never stops a reused pid that looks like a server: its command ends in `start` and a Cello answers on the lock's port, but that Cello listens from another pid",
    () =>
      Effect.gen(function* () {
        const dir = yield* tempDataDir
        const { port } = yield* startServer(path.join(dir, "served")) // a live Cello on the lock's port, in this process
        const { dataDir, install, writeLock, plist } = yield* setup()
        // A stale lock's pid, since taken by some other `… start` command.
        const reused = yield* Effect.acquireRelease(
          Effect.sync(() => Bun.spawn(["sh", "-c", "sleep 300", "start"])),
          (proc) => Effect.promise(async () => {
            if (proc.exitCode === null && proc.signalCode === null) proc.kill("SIGKILL")
            await proc.exited
          }),
        )
        writeLock(reused.pid, port)

        expect((yield* install("--replace")).failure).toBe(staleLockText(dataDir, { pid: reused.pid, port }))
        expect(isAlive(reused.pid)).toBe(true)
        expect(fs.existsSync(plist)).toBe(false)
      }).pipe(Effect.scoped),
  )

  it.live("a failed install that stopped another folder's service names that folder, not the new one", () =>
    Effect.gen(function* () {
      const { dir, dataDir, install, runWith, state, loadJob } = yield* setup()
      expect((yield* install()).failure).toBeNull()
      const job = yield* sleeper
      loadJob(job.pid)
      fs.writeFileSync(path.join(state, "bootstrap-fails"), "")
      const other = path.join(dir, "other")

      const failed = yield* runWith({ CELLO_DATA_DIR: other })("service", "install", "--temporary", "--replace")

      expect(failed.failure).toBe(failedInstallText({ reason: "Bootstrap failed: 5: Input/output error", stopped: [dataDir], restored: "not loaded" }))
      expect(failed.failure).not.toContain(other)
    }).pipe(Effect.scoped))

  it.live("never signals a pid that can't be another server: 0, 1, -1, or this very process", () =>
    Effect.gen(function* () {
      const { dataDir, install, writeLock } = yield* setup()
      for (const pid of [0, 1, -1, process.pid]) {
        writeLock(pid, 4791)
        expect((yield* install("--replace")).failure).toBe(invalidLockText(dataDir, pid))
      }
    }).pipe(Effect.scoped))

  it.live("installing again with the same settings unloads the running service first, then loads the plist again", () =>
    Effect.gen(function* () {
      const { install, calls, plist, loadJob, writeLock } = yield* setup()
      expect((yield* install()).failure).toBeNull()
      const job = yield* sleeper
      loadJob(job.pid)
      writeLock(job.pid, 1) // the service's own server isn't "another server"

      const again = yield* install()

      expect(again.failure).toBeNull()
      expect(calls().slice(2)).toEqual([`print ${TARGET}`, `bootout ${TARGET}`, `enable ${TARGET}`, `bootstrap gui/${UID} ${plist}`])
      expect(yield* Effect.promise(() => job.exited)).not.toBe(0)
    }).pipe(Effect.scoped))

  it.live("won't replace a service for another data folder or port without --replace, naming both", () =>
    Effect.gen(function* () {
      const { dir, dataDir, program, install, runWith, calls, plist } = yield* setup()
      expect((yield* install()).failure).toBeNull()
      const before = fs.readFileSync(plist, "utf8")
      const other = path.join(dir, "other")
      const otherInstall = runWith({ CELLO_DATA_DIR: other, CELLO_PORT: "4799" })

      const refused = yield* otherInstall("service", "install", "--temporary")
      expect(refused.failure).toBe(otherServiceText(
        { program: [program, "start"], dataDir, port: 1 },
        { program: [program, "start"], dataDir: other, port: 4799 },
      ))
      expect(fs.readFileSync(plist, "utf8")).toBe(before)
      expect(calls()).toHaveLength(2)

      const replaced = yield* otherInstall("service", "install", "--temporary", "--replace")
      expect(replaced.failure).toBeNull()
      expect(replaced.out).toContain(`It replaces the service that ran \`${program} start\` for ${dataDir}.`)
      expect(fs.readFileSync(plist, "utf8")).toContain(`<string>${other}</string>`)
    }).pipe(Effect.scoped))

  it.live("says plainly when launchctl isn't there (not macOS), before changing anything", () =>
    Effect.gen(function* () {
      const { dir, runWith, plist } = yield* setup()
      expect((yield* runWith({ PATH: path.join(dir, "nowhere") })("service", "install", "--temporary")).failure).toBe(
        "`cello service` runs Cello as a macOS launchd service, and launchctl isn't on the PATH. On other systems, run `cello start` yourself.",
      )
      expect(fs.existsSync(plist)).toBe(false)
    }).pipe(Effect.scoped))

  it.live("a first install that launchd won't load leaves no plist behind, and says launchctl's words", () =>
    Effect.gen(function* () {
      const { dataDir, install, state, plist } = yield* setup()
      fs.writeFileSync(path.join(state, "bootstrap-fails"), "")
      expect((yield* install()).failure).toBe(failedInstallText({ reason: "Bootstrap failed: 5: Input/output error", stopped: [], restored: null }))
      expect(fs.existsSync(plist)).toBe(false)
    }).pipe(Effect.scoped))

  it.live("a reinstall that launchd won't load puts the old plist back, and says the server stopped and how to start it", () =>
    Effect.gen(function* () {
      const { dataDir, install, state, plist, loadJob, calls } = yield* setup()
      expect((yield* install()).failure).toBeNull()
      const before = fs.readFileSync(plist, "utf8")
      const job = yield* sleeper
      loadJob(job.pid)
      fs.writeFileSync(path.join(state, "bootstrap-fails"), "")

      const failed = yield* install()

      expect(failed.failure).toBe(failedInstallText({ reason: "Bootstrap failed: 5: Input/output error", stopped: [dataDir], restored: "not loaded" }))
      expect(failed.failure).toContain("cello start")
      expect(fs.readFileSync(plist, "utf8")).toBe(before)
      expect(fs.existsSync(`${plist}.bak`)).toBe(false)
      expect(calls().filter((call) => call.startsWith("bootstrap"))).toHaveLength(3) // the first install, the new one, the old one again
    }).pipe(Effect.scoped))
})

describe("cello service status", () => {
  it.live("before install: not installed, and names a server running anyway", () =>
    Effect.gen(function* () {
      const { dataDir, run, writeLock } = yield* setup()
      const server = yield* sleeper
      writeLock(server.pid, 4791)
      expect((yield* run("service", "status")).out).toBe([
        "The background service isn't installed: nothing starts Cello at login, or again when it stops.",
        `A server is running for ${dataDir} (pid ${server.pid}, http://127.0.0.1:4791), started by hand or by the desktop app.`,
        "Install the service with `cello service install`.",
      ].join("\n"))
    }).pipe(Effect.scoped))

  it.live("installed and running: its pid, the server's version, and the log's last lines", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const { port } = yield* startServer(path.join(dir, "served"))
      const { install, run, loadJob, logPath, plist, program } = yield* setup({ port })
      expect((yield* install()).failure).toBeNull()
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
      const { install, run, program } = yield* setup()
      expect((yield* install()).failure).toBeNull()
      fs.rmSync(program)
      const status = yield* run("service", "status")
      expect(status.out.split("\n")[0]).toBe("Background service dev.cello.server: installed, not running (last exit code 78: EX_CONFIG)")
      expect(status.out).toContain(staleProgram([program, "start"]))
    }).pipe(Effect.scoped))
})

describe("cello service restart", () => {
  it.live("asks launchd to send the server SIGTERM (a clean shutdown), then waits for the new server KeepAlive starts to answer", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const { port } = yield* startServer(path.join(dir, "served"))
      const { install, run, calls, loadJob, program, state } = yield* setup({ port })
      expect((yield* install()).failure).toBeNull()
      const job = yield* sleeper
      loadJob(job.pid)
      fs.writeFileSync(path.join(state, "respawn"), "")

      const restarted = yield* run("service", "restart")

      expect(restarted.failure).toBeNull()
      expect(calls()).toContain(`kill SIGTERM ${TARGET}`)
      expect(calls().some((call) => call.startsWith("kickstart"))).toBe(false)
      expect(yield* Effect.promise(() => job.exited)).not.toBe(0)
      const fresh = fakeJobPid(state)!
      expect(fresh).not.toBe(job.pid)
      expect(restarted.out).toBe(
        `Restarted the background service: launchd started \`${program} start\` again (pid ${fresh}), and it answers on http://127.0.0.1:${port}.`,
      )
    }).pipe(Effect.scoped))

  it.live("starts a service that isn't running (kickstart, no kill)", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const { port } = yield* startServer(path.join(dir, "served"))
      const { install, run, calls, state } = yield* setup({ port })
      expect((yield* install()).failure).toBeNull() // loaded, no job process
      fs.writeFileSync(path.join(state, "respawn"), "")
      expect((yield* run("service", "restart")).failure).toBeNull()
      expect(calls()).toContain(`kickstart ${TARGET}`)
      expect(calls().some((call) => call.startsWith("kill"))).toBe(false)
    }).pipe(Effect.scoped))

  it.live("says so, with where to look, when no new server comes back", () =>
    Effect.gen(function* () {
      const { install, runWith, loadJob } = yield* setup()
      expect((yield* install()).failure).toBeNull()
      const job = yield* sleeper
      loadJob(job.pid) // no respawn: nothing comes back
      const restarted = yield* runWith({ CELLO_TEST_SERVICE_WAIT_MS: "300" })("service", "restart")
      expect(restarted.failure).toBe(restartTimeoutText(1, 0.3))
    }).pipe(Effect.scoped))

  it.live("refuses when the service isn't installed, or its program is gone", () =>
    Effect.gen(function* () {
      const { install, run, program } = yield* setup()
      expect((yield* run("service", "restart")).failure).toBe("The background service isn't installed. Install it with `cello service install`.")
      expect((yield* install()).failure).toBeNull()
      fs.rmSync(program)
      expect((yield* run("service", "restart")).failure).toBe(staleProgram([program, "start"]))
    }).pipe(Effect.scoped))
})

describe("cello service uninstall", () => {
  it.live("unloads the service (stopping its server) and deletes the plist; the data folder and log stay", () =>
    Effect.gen(function* () {
      const { install, run, calls, loadJob, plist, dataDir, logPath } = yield* setup()
      expect((yield* install()).failure).toBeNull()
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
