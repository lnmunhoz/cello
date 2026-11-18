// `cello backup`, `cello backup list` and `cello restore` against a real server with a temp data
// folder: what each prints, that backup and list work with or without a server, and that restore
// waits for the server to stop.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import type { Backup } from "@cello/contract/backups"
import { formatBytes as bytes } from "@cello/text/bytes"
import { writePng, writeText } from "@cello/server/testing/media"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import { AGENT_IDENTITY, connect } from "../../../server/test/integration/harness.ts"
import { localTime } from "../../src/format.ts"
import { cello, TEST_HOME } from "./cli.ts"

/** A running server (stopped by closing `running`), a project and a review with two files. */
const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const running = yield* Scope.make()
  const { port } = yield* startServer(dataDir).pipe(Scope.provide(running))
  const human = yield* connect(port).pipe(Scope.provide(running))
  const agent = yield* connect(port, AGENT_IDENTITY).pipe(Scope.provide(running))
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL" })
  const { result: task } = yield* agent["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Backups" })
  const scratch = path.join(dataDir, "scratch")
  fs.mkdirSync(scratch)
  yield* agent["review.submit"]({
    commandId: newCommandId(),
    key: task.key,
    summary: "Evidence",
    steps: ["Look"],
    files: [{ path: writePng(scratch, "board.png") }, { path: writeText(scratch, "vitest.txt", "Tests 12 passed") }],
    links: [],
  })
  const run = cello({ port, cwd: dataDir, env: { CELLO_DATA_DIR: dataDir } })
  const stop = Scope.close(running, Exit.void)
  return { dataDir, port, human, project, task, run, stop }
})

const assetLine = (b: Backup) =>
  `  assets    ${b.assets.files} files, ${bytes(b.assets.bytes)}: ${b.assets.linked} linked to the previous backup, ` +
  `${b.assets.copied} copied (${bytes(b.assets.copiedBytes)} new)`

describe("the test harness", () => {
  it.live("never lets a command reach ~/.cello: without CELLO_DATA_DIR, the data folder is a temp path that doesn't exist", () =>
    Effect.gen(function* () {
      const scratch = yield* tempDataDir
      const forgetful = cello({ port: 1, cwd: scratch }) // no server, no CELLO_DATA_DIR
      expect(TEST_HOME.startsWith(os.tmpdir())).toBe(true)
      expect((yield* forgetful("backup", "list")).out).toBe(
        `No backups in ${path.join(TEST_HOME, ".cello", "backups")} yet. Take one with \`cello backup\`; the server also takes one every day.`,
      )
      expect((yield* forgetful("backup")).failure).toBe(`There's no Cello database in ${path.join(TEST_HOME, ".cello")} yet, so there's nothing to back up.`)
      expect((yield* forgetful("restore", "20261115-120000")).failure).toContain(path.join(TEST_HOME, ".cello", "backups"))
      expect(fs.existsSync(TEST_HOME)).toBe(false)
    }).pipe(Effect.scoped))
})

describe("cello backup", () => {
  it.live("takes one through the running server and prints its folder, size, and linked vs copied files", () =>
    Effect.gen(function* () {
      const { run, human } = yield* setup

      const first = yield* run("backup")
      expect(first.failure).toBeNull()
      const [taken] = yield* human["backup.list"]({})
      expect(first.out).toBe([`Backed up to ${taken!.path}`, `  database  ${bytes(taken!.dbBytes)}`, assetLine(taken!)].join("\n"))
      expect(taken!.assets).toMatchObject({ files: 2, linked: 0, copied: 2 })

      const second = yield* run("backup", "--json")
      const json = JSON.parse(second.out) as Backup
      expect(json.assets).toMatchObject({ files: 2, linked: 2, copied: 0, copiedBytes: 0 })
      expect(json.kind).toBe("manual")
      expect(yield* human["backup.list"]({})).toEqual([json, taken])
    }).pipe(Effect.scoped))

  it.live("with no server running, takes the backup itself and says so", () =>
    Effect.gen(function* () {
      const { run, stop, dataDir } = yield* setup
      yield* stop
      const result = yield* run("backup")
      expect(result.failure).toBeNull()
      const lines = result.out.split("\n")
      expect(lines[0]).toBe(`Cello isn't running, so the backup was taken straight from ${dataDir}.`)
      expect(lines[1]).toMatch(new RegExp(`^Backed up to ${dataDir}/backups/\\d{8}-\\d{6}$`))
    }).pipe(Effect.scoped))
})

describe("cello backup that fails", () => {
  // A file where the backups folder goes: creating the backup fails, for root too (the Docker runner),
  // unlike a `chmod 000` file. A failure part-way through copying is tested in the server's tests.
  const blockBackups = (dataDir: string) => fs.writeFileSync(path.join(dataDir, "backups"), "in the way")

  const FAILED = (dataDir: string) =>
    new RegExp(
      `^The backup failed \\(E[A-Z]+: [^)]*${dataDir}/backups[^)]*\\)\\. Nothing was saved, and your data and earlier backups are untouched\\. ` +
        `Check that the disk has room, that every file in ${dataDir}/assets can be read and that ${dataDir}/backups can be written, ` +
        `then run \\\`cello backup\\\` again\\.$`,
    )

  it.live("through the running server prints why, and leaves nothing half-made", () =>
    Effect.gen(function* () {
      const { run, dataDir } = yield* setup
      blockBackups(dataDir)
      const result = yield* run("backup")
      expect(result.failure).toMatch(FAILED(dataDir))
      expect(fs.readFileSync(path.join(dataDir, "backups"), "utf8")).toBe("in the way")
      expect(fs.readdirSync(dataDir).filter((name) => name.startsWith("."))).toEqual([])
    }).pipe(Effect.scoped))

  it.live("with no server running prints why too", () =>
    Effect.gen(function* () {
      const { run, stop, dataDir } = yield* setup
      yield* stop
      blockBackups(dataDir)
      expect((yield* run("backup")).failure).toMatch(FAILED(dataDir))
      expect(fs.readFileSync(path.join(dataDir, "backups"), "utf8")).toBe("in the way")
      expect(fs.existsSync(path.join(dataDir, "server.lock"))).toBe(false)
    }).pipe(Effect.scoped))
})

describe("cello backup list", () => {
  it.live("shows id, time, kind, size and asset count, newest first, with or without the server", () =>
    Effect.gen(function* () {
      const { run, stop, dataDir } = yield* setup
      const empty = yield* run("backup", "list")
      expect(empty.out).toBe(`No backups in ${dataDir}/backups yet. Take one with \`cello backup\`; the server also takes one every day.`)

      yield* run("backup")
      yield* run("backup")
      const backups = JSON.parse((yield* run("backup", "list", "--json")).out) as Array<Backup>
      expect(backups).toHaveLength(2)
      const listed = (yield* run("backup", "list")).out
      const size = (b: Backup) => bytes(b.dbBytes + b.assets.bytes)
      const idWidth = Math.max(...backups.map((b) => b.id.length))
      const sizeWidth = Math.max(...backups.map((b) => size(b).length))
      expect(listed).toBe(backups.map((b) =>
        [b.id.padEnd(idWidth), localTime(b.createdAt), "manual", size(b).padEnd(sizeWidth), "2 files"].join("  ")
      ).join("\n"))

      // Stopped, the list is read from the folder and looks the same.
      yield* stop
      expect((yield* run("backup", "list")).out).toBe(listed)
    }).pipe(Effect.scoped))
})

describe("cello restore", () => {
  it.live("is refused while the server runs, with how to stop it", () =>
    Effect.gen(function* () {
      const { run, dataDir, port } = yield* setup
      const backup = JSON.parse((yield* run("backup", "--json")).out) as Backup
      expect((yield* run("restore", backup.id)).failure).toBe(
        `Cello is running for ${dataDir} (pid ${process.pid}, http://127.0.0.1:${port}), and restore only runs while it's stopped; ` +
          "nothing was changed. Stop it: press Ctrl-C in the terminal running `cello start`, or quit the Cello desktop app " +
          `(there's no \`cello stop\` yet). Then run \`cello restore ${backup.id}\` again.`,
      )
    }).pipe(Effect.scoped))

  it.live("after the server stops, restores the backup and prints what it restored and where the replaced state went", () =>
    Effect.gen(function* () {
      const { run, stop, human, project } = yield* setup
      const backup = JSON.parse((yield* run("backup", "--json")).out) as Backup
      yield* human["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "After the backup" })
      yield* stop

      const result = yield* run("restore", backup.id)
      expect(result.failure).toBeNull()
      const all = JSON.parse((yield* run("backup", "list", "--json")).out) as Array<Backup>
      const safety = all.find((b) => b.note === `before restoring ${backup.id}`)!
      expect(result.out).toBe([
        `Restored backup ${backup.id} (manual, taken ${localTime(backup.createdAt)})`,
        `  database  ${bytes(backup.dbBytes)}, schema level ${backup.schemaLevel}`,
        `  assets    2 files, ${bytes(backup.assets.bytes)}`,
        `What it replaced is saved as backup ${safety.id}; \`cello restore ${safety.id}\` brings it back.`,
        "Start Cello again: `cello start`, or open the desktop app.",
      ].join("\n"))
      const row = (yield* run("backup", "list")).out.split("\n").find((line) => line.startsWith(safety.id))!
      expect(row).toMatch(new RegExp(`^${safety.id}  .*  safety  .*  before restoring ${backup.id}$`))
    }).pipe(Effect.scoped))

  it.live.skipIf(process.platform !== "darwin")("that fails while swapping (assets/ locked with chflags uchg) prints that nothing changed and the safety backup", () =>
    Effect.gen(function* () {
      const { run, stop, dataDir } = yield* setup
      const backup = JSON.parse((yield* run("backup", "--json")).out) as Backup
      yield* stop
      const assets = path.join(dataDir, "assets")
      Bun.spawnSync(["chflags", "uchg", assets])
      yield* Effect.addFinalizer(() => Effect.sync(() => Bun.spawnSync(["chflags", "nouchg", assets])))

      const result = yield* run("restore", backup.id)
      const safety = (JSON.parse((yield* run("backup", "list", "--json")).out) as Array<Backup>).find((b) => b.kind === "safety")!
      expect(result.failure).toMatch(new RegExp(
        `^The restore of ${backup.id} failed while swapping the files in \\(EPERM: [^)]*\\)\\. ` +
          `Nothing was changed: your data is as it was, and safety backup ${safety.id} holds it too\\.$`,
      ))
      expect(fs.readdirSync(dataDir).filter((name) => name.startsWith("."))).toEqual([])
    }).pipe(Effect.scoped))

  it.live("warns when the backup holds fewer evidence files than its manifest lists", () =>
    Effect.gen(function* () {
      const { run, stop } = yield* setup
      const backup = JSON.parse((yield* run("backup", "--json")).out) as Backup
      yield* stop
      fs.rmSync(path.join(backup.path, "assets"), { recursive: true })
      const result = yield* run("restore", backup.id)
      expect(result.failure).toBeNull()
      expect(result.out.split("\n").slice(2, 4)).toEqual([
        "  assets    0 files, 0 B",
        "  warning   the backup's manifest lists 2 evidence files but only 0 were there to restore (was its assets/ folder changed by hand?); reviews and pages may show missing files.",
      ])
    }).pipe(Effect.scoped))

  it.live("an unknown id says where to find the real ones", () =>
    Effect.gen(function* () {
      const { run, stop, dataDir } = yield* setup
      yield* stop
      expect((yield* run("restore", "20991231-235959")).failure).toBe(
        `No backup 20991231-235959 in ${dataDir}/backups. Run \`cello backup list\` to see them.`,
      )
    }).pipe(Effect.scoped))
})
