// Backups against a real server with a temp data folder: a backup taken mid-write is a consistent
// database; unchanged evidence files are hard links in the next backup; restore brings back the
// database and the files after the server stops, and refuses while it runs.
import { Database } from "bun:sqlite"
import * as fs from "node:fs"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import type { CelloClient } from "@cello/client/client"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import * as Scope from "effect/Scope"
import { BACKUPS_DIR } from "../../src/backup/BackupService.ts"
import { backupOffline, restore } from "../../src/backup/offline.ts"
import { writePng, writeText } from "../../src/testing/media.ts"
import { AGENT_IDENTITY, connect, startServer, tempDataDir, withClient } from "./harness.ts"

type Client = CelloClient["Service"]

/** A CEL project with an agent task that has a review packet carrying a screenshot and a log. */
const boardWithEvidence = (human: Client, agent: Client, scratch: string) =>
  Effect.gen(function* () {
    const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
    const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL" })
    const { result: task } = yield* agent["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Backups" })
    yield* agent["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Second task" })
    fs.mkdirSync(scratch, { recursive: true })
    yield* agent["review.submit"]({
      commandId: newCommandId(),
      key: task.key,
      summary: "Evidence",
      steps: ["Look"],
      files: [{ path: writePng(scratch, "board.png") }, { path: writeText(scratch, "vitest.txt", "Tests 12 passed") }],
      links: [],
    })
    return { project, task }
  })

/** Every file under `dir`, relative path → content. */
const filesIn = (dir: string): Record<string, string> =>
  Object.fromEntries(
    (fs.readdirSync(dir, { recursive: true }) as string[])
      .filter((name) => fs.statSync(path.join(dir, name)).isFile())
      .sort()
      .map((name) => [name, fs.readFileSync(path.join(dir, name)).toString("base64")]),
  )

const titles = (client: Client) =>
  Effect.map(client["snapshot.get"]({}), (s) => s.tasks.map((t) => `${t.key} ${t.title}`).sort())

describe("backups of a running server", () => {
  it.live("a backup taken while tasks are being written opens, passes integrity_check and holds a consistent snapshot", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const { port } = yield* startServer(dataDir)
      const human = yield* connect(port)
      const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
      const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL" })
      const create = (i: number) => human["task.create"]({ commandId: newCommandId(), projectId: project.id, title: `Task ${i}` })
      yield* Effect.forEach(Array.from({ length: 20 }, (_, i) => i), create, { concurrency: 4 })

      // A hundred more writes in flight while the backup runs.
      const [backup] = yield* Effect.all([
        human["backup.create"]({}),
        Effect.forEach(Array.from({ length: 100 }, (_, i) => 20 + i), create, { concurrency: 8 }),
      ], { concurrency: "unbounded" })

      const db = new Database(path.join(backup.path, "cello.db"), { readonly: true })
      expect(db.query("PRAGMA integrity_check").all()).toEqual([{ integrity_check: "ok" }])
      const tasks = (db.query("SELECT COUNT(*) AS n FROM tasks").get() as { n: number }).n
      const created = (db.query("SELECT COUNT(*) AS n FROM events WHERE type = 'task.created'").get() as { n: number }).n
      const orphans = db.query("SELECT id FROM tasks WHERE id NOT IN (SELECT entity_id FROM events WHERE type = 'task.created')").all()
      db.close()
      // Everything written before it started is there, and every task arrived with its event: no torn writes.
      expect(tasks).toBeGreaterThanOrEqual(20)
      expect(tasks).toBeLessThanOrEqual(120)
      expect(created).toBe(tasks)
      expect(orphans).toEqual([])
      expect(backup).toMatchObject({ kind: "manual", note: null, dbBytes: fs.statSync(path.join(backup.path, "cello.db")).size })
      expect(yield* human["backup.list"]({})).toEqual([backup])
    }).pipe(Effect.scoped))

  it.live("an unchanged evidence file is a hard link in the next backup; a changed one is a fresh copy", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const { port } = yield* startServer(dataDir)
      const human = yield* connect(port)
      const agent = yield* connect(port, AGENT_IDENTITY)
      const { task } = yield* boardWithEvidence(human, agent, path.join(dataDir, "scratch"))
      const taskFiles = path.join(dataDir, "assets", task.id)
      const [png, txt] = fs.readdirSync(taskFiles).sort((a) => (a.endsWith(".png") ? -1 : 1))

      const first = yield* human["backup.create"]({})
      expect(first.assets).toMatchObject({ files: 2, linked: 0, copied: 2 })

      // The log changes; the screenshot doesn't.
      fs.writeFileSync(path.join(taskFiles, txt!), "Tests 13 passed")
      const second = yield* human["backup.create"]({})
      expect(second.assets).toMatchObject({ files: 2, linked: 1, copied: 1, copiedBytes: "Tests 13 passed".length })

      const inode = (backup: { path: string }, name: string) => fs.statSync(path.join(backup.path, "assets", task.id, name)).ino
      expect(inode(second, png!)).toBe(inode(first, png!))
      expect(inode(second, txt!)).not.toBe(inode(first, txt!))
      expect(fs.readFileSync(path.join(second.path, "assets", task.id, txt!), "utf8")).toBe("Tests 13 passed")
      expect(fs.readFileSync(path.join(first.path, "assets", task.id, txt!), "utf8")).toBe("Tests 12 passed")

      // Touched but identical (a new modification time, the same bytes): recognized by sha256 and linked.
      const later = new Date(Date.now() + 60_000)
      fs.utimesSync(path.join(taskFiles, png!), later, later)
      const third = yield* human["backup.create"]({})
      expect(third.assets).toMatchObject({ linked: 2, copied: 0, copiedBytes: 0 })
      expect(inode(third, png!)).toBe(inode(first, png!))
    }).pipe(Effect.scoped))
})

describe("restore", () => {
  it.live("round trip: back up, change things, stop the server, restore, start it again; the data and files are the backup's", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const running = yield* Scope.make()
      const { port } = yield* startServer(dataDir).pipe(Scope.provide(running))
      const human = yield* connect(port).pipe(Scope.provide(running))
      const agent = yield* connect(port, AGENT_IDENTITY).pipe(Scope.provide(running))
      const { project, task } = yield* boardWithEvidence(human, agent, path.join(dataDir, "scratch"))
      const backup = yield* human["backup.create"]({})
      const tasksBefore = yield* titles(human)
      const filesBefore = filesIn(path.join(dataDir, "assets"))
      const screenshot = (yield* human["review.list"]({ taskId: task.id }))[0]!.attachments.find((a) => a.kind === "image")!

      // Afterwards: a new task, a renamed one, a second review with a new file, and a damaged file.
      yield* agent["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Made after the backup" })
      yield* human["task.update"]({ commandId: newCommandId(), id: task.id, expectedVersion: (yield* agent["task.get"]({ key: task.key })).task.version, title: "Renamed" })
      yield* agent["review.submit"]({
        commandId: newCommandId(),
        key: task.key,
        summary: "More",
        steps: ["Look again"],
        files: [{ path: writeText(path.join(dataDir, "scratch"), "later.txt", "added later") }],
        links: [],
      })
      const damaged = path.join(dataDir, "assets", task.id, `${screenshot.id}.png`)
      fs.writeFileSync(damaged, "overwritten")
      const tasksAfter = yield* titles(human)
      yield* Scope.close(running, Exit.void)

      const restored = yield* restore({ dataDir, id: backup.id })

      expect(restored.backup).toEqual(backup)
      expect(restored.assets).toEqual({ files: 2, bytes: backup.assets.bytes })
      expect(restored.safety).toMatchObject({ kind: "manual", note: `before restoring ${backup.id}` })
      // The safety backup holds the state restore replaced.
      const safetyDb = new Database(path.join(restored.safety!.path, "cello.db"), { readonly: true })
      expect((safetyDb.query("SELECT title FROM tasks ORDER BY number").all() as Array<{ title: string }>).map((r) => r.title))
        .toEqual(["Renamed", "Second task", "Made after the backup"])
      safetyDb.close()
      expect(fs.readFileSync(path.join(restored.safety!.path, "assets", task.id, `${screenshot.id}.png`), "utf8")).toBe("overwritten")
      // Nothing is left over: no staging folder, no stale -wal or -shm, no lock.
      expect(fs.readdirSync(dataDir).sort()).toEqual(["assets", BACKUPS_DIR, "cello.db", "scratch"])
      expect(filesIn(path.join(dataDir, "assets"))).toEqual(filesBefore)

      const { port: again } = yield* startServer(dataDir)
      yield* withClient(again, (client) =>
        Effect.gen(function* () {
          const tasks = yield* titles(client)
          expect(tasks).toEqual(tasksBefore)
          expect(tasks).not.toEqual(tasksAfter)
        }))
      // The damaged screenshot is whole again, and the server serves it.
      const served = yield* Effect.promise(() => fetch(`http://127.0.0.1:${again}/attachments/${screenshot.id}`).then((r) => r.arrayBuffer()))
      expect(Buffer.from(served).equals(fs.readFileSync(path.join(dataDir, "scratch", "board.png")))).toBe(true)
    }).pipe(Effect.scoped))

  it.live("is refused while a server holds the data folder, and changes nothing", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const { port } = yield* startServer(dataDir)
      const human = yield* connect(port)
      const backup = yield* human["backup.create"]({})
      const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
      yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL" })

      const error = yield* Effect.flip(restore({ dataDir, id: backup.id }))
      expect(error).toMatchObject({ _tag: "RestoreBlocked", id: backup.id, dataDir, pid: process.pid, port })

      expect((yield* human["snapshot.get"]({})).projects.map((p) => p.key)).toEqual(["CEL"])
      expect((yield* human["backup.list"]({})).map((b) => b.id)).toEqual([backup.id])
      expect(fs.readdirSync(dataDir).filter((name) => name.startsWith("."))).toEqual([])
    }).pipe(Effect.scoped))

  it.live("refuses an unknown id, a backup a newer Cello made, and a damaged database, changing nothing", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const backup = yield* Effect.scoped(Effect.gen(function* () {
        const { port } = yield* startServer(dataDir)
        return yield* withClient(port, (client) => client["backup.create"]({}))
      }))
      const db = fs.readFileSync(path.join(dataDir, "cello.db"))

      expect(yield* Effect.flip(restore({ dataDir, id: "20991231-235959" })))
        .toMatchObject({ _tag: "BackupNotFound", id: "20991231-235959", dir: path.join(dataDir, BACKUPS_DIR) })

      const manifestFile = path.join(backup.path, "manifest.json")
      const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"))
      fs.writeFileSync(manifestFile, JSON.stringify({ ...manifest, schemaLevel: 999 }))
      expect(yield* Effect.flip(restore({ dataDir, id: backup.id })))
        .toMatchObject({ _tag: "BackupTooNew", id: backup.id, schemaLevel: 999, known: manifest.schemaLevel })
      fs.writeFileSync(manifestFile, JSON.stringify(manifest))

      fs.writeFileSync(path.join(backup.path, "cello.db"), "not a database")
      expect(yield* Effect.flip(restore({ dataDir, id: backup.id }))).toMatchObject({ _tag: "BackupDamaged", id: backup.id })

      expect(fs.readFileSync(path.join(dataDir, "cello.db")).equals(db)).toBe(true)
      expect(fs.readdirSync(dataDir).filter((name) => name.startsWith("."))).toEqual([])
    }).pipe(Effect.scoped))
})

describe("a backup with no server running", () => {
  it.live("takes the data folder's lock, so it's refused while a server runs, and works once it stops", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const running = yield* Scope.make()
      const { port } = yield* startServer(dataDir).pipe(Scope.provide(running))
      expect(yield* Effect.flip(backupOffline({ dataDir }))).toMatchObject({ _tag: "ServerAlreadyRunning", pid: process.pid, port })
      yield* Scope.close(running, Exit.void)

      const backup = yield* backupOffline({ dataDir })
      expect(backup).toMatchObject({ kind: "manual", path: path.join(dataDir, BACKUPS_DIR, backup.id) })
      expect(fs.existsSync(path.join(dataDir, "server.lock"))).toBe(false)
    }).pipe(Effect.scoped))

  it.live("has nothing to back up in a folder without a database, and leaves it as it was", () =>
    Effect.gen(function* () {
      const dataDir = path.join(yield* tempDataDir, "never-started")
      expect(yield* Effect.flip(backupOffline({ dataDir }))).toMatchObject({ _tag: "NothingToBackUp", dataDir })
      expect(fs.existsSync(dataDir)).toBe(false)
    }).pipe(Effect.scoped))
})
