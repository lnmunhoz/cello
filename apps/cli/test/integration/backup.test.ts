// `cello backup`, `cello backup list` and `cello restore` against a real server with a temp data
// folder: what each prints, that backup and list work with or without a server, and that restore
// waits for the server to stop.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import type { Backup } from "@cello/contract/backups"
import { writePng, writeText } from "@cello/server/testing/media"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import { AGENT_IDENTITY, connect } from "../../../server/test/integration/harness.ts"
import { bytes, localTime } from "../../src/format.ts"
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
        `Cello is running for ${dataDir} (pid ${process.pid}, http://127.0.0.1:${port}). Stop it before restoring: ` +
          "press Ctrl-C where `cello start` runs, or quit the Cello desktop app (there's no `cello stop` yet). " +
          `Then run \`cello restore ${backup.id}\` again.`,
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
      expect((yield* run("backup", "list")).out).toContain(`before restoring ${backup.id}`)
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
