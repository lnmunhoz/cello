// Documents: publishing a page records a version as the calling session; the same slug or the same
// source file updates it (the link never changes); uploaded images are copied into the data folder
// and the markdown points at them; tasks link by key.
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as TestClock from "effect/testing/TestClock"
import * as EventStore from "../events/EventStore.ts"
import * as AssetStore from "../review/AssetStore.ts"
import * as ReviewService from "../review/ReviewService.ts"
import * as SnapshotService from "../snapshot/SnapshotService.ts"
import * as TaskService from "../task/TaskService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { writePng, writeText } from "../testing/media.ts"
import { tempDataDir } from "../testing/tempDir.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import * as DocumentService from "./DocumentService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) =>
  asHuman(effect).pipe(Effect.provide(services({ ffmpeg: null })), Effect.scoped) as Effect.Effect<A, E>

const agent = asAgent({ session: "session-docs", client: "Claude Code", pid: process.pid })
const CEL = { key: "CEL" }

const REPORT = [
  "# Billing audit",
  "",
  "We checked **every** invoice since March.",
  "",
  "## Findings",
  "",
  "Two duplicates.",
  "",
  "## Next steps",
  "",
  "Refund them.",
].join("\n")

const setup = Effect.gen(function* () {
  const documents = yield* DocumentService.DocumentService
  const tasks = yield* TaskService.TaskService
  const { project, workspace, status } = yield* setupProject
  const files = yield* tempDataDir
  return { documents, tasks, project, workspace, status, files }
})

const publish = (input: Partial<DocumentService.PublishDocument> & { body: string }) => ({ commandId: cmd(), project: CEL, ...input })

const eventsOf = (commandId: string) =>
  Effect.gen(function* () {
    const store = yield* EventStore.EventStore
    const workspaceId = (yield* (yield* SnapshotService.SnapshotService).get()).workspaces[0]!.id
    return (yield* store.readAfter({ workspaceId, projectId: null }, 0)).filter((e) => e.commandId === commandId)
  })

describe("DocumentService.publish", () => {
  it.effect("publishes a page as the calling session: title and summary from the markdown, a slug from the title, version 1", () =>
    run(Effect.gen(function* () {
      const { documents, project, workspace } = yield* setup
      const input = publish({ body: REPORT })
      const { result, seq } = yield* agent(documents.publish(input))

      expect(result).toMatchObject({
        projectId: project.id,
        workspaceId: workspace.id,
        kind: "page",
        slug: "billing-audit",
        title: "Billing audit",
        summary: "We checked every invoice since March.",
        version: 1,
        body: REPORT,
        tasks: [],
        archivedAt: null,
        updatedBy: { name: "Claude Code", session: "session-docs" },
      })
      expect(result.createdBySessionId).not.toBeNull()
      expect(result.updatedBySessionId).toBe(result.createdBySessionId)

      const events = yield* eventsOf(input.commandId)
      expect(events.map((e) => e.type)).toEqual(["document.published"])
      expect(events[0]).toMatchObject({ seq, projectId: project.id, sessionId: result.createdBySessionId })
      expect(events[0]).not.toHaveProperty("document.body")

      // Boards get the summary in their snapshot; the body comes with `get`.
      const snapshot = yield* (yield* SnapshotService.SnapshotService).get()
      expect(snapshot.documents.map((d) => d.slug)).toEqual(["billing-audit"])
      expect(snapshot.documents[0]).not.toHaveProperty("body")
      expect((yield* documents.get({ project: CEL, slug: "billing-audit" })).body).toBe(REPORT)
    })))

  it.effect("the same slug saves a new version, and every version stays readable", () =>
    run(Effect.gen(function* () {
      const { documents } = yield* setup
      yield* agent(documents.publish(publish({ body: REPORT })))
      const changed = REPORT.replace("Two duplicates.", "Three duplicates.")
      const input = publish({ body: changed, slug: "billing-audit", title: "Billing audit, revised" })
      const { result } = yield* documents.publish(input)

      expect(result).toMatchObject({ slug: "billing-audit", version: 2, title: "Billing audit, revised", body: changed })
      expect(result.updatedBy).toMatchObject({ name: "Lucas", session: null })
      expect((yield* eventsOf(input.commandId)).map((e) => e.type)).toEqual(["document.updated"])

      const first = yield* documents.get({ project: CEL, slug: "billing-audit", version: 1 })
      expect(first).toMatchObject({ version: 1, title: "Billing audit", body: REPORT, updatedBy: { name: "Claude Code", session: "session-docs" } })
      const history = yield* documents.history(result.id)
      expect(history.map((v) => [v.version, v.title, v.author.name])).toEqual([
        [2, "Billing audit, revised", "Lucas"],
        [1, "Billing audit", "Claude Code"],
      ])
      expect(yield* Effect.flip(documents.get({ project: CEL, slug: "billing-audit", version: 3 }))).toMatchObject({ _tag: "NotFound" })
    })))

  it.effect("the same source file updates its page; another file with the same title gets its own slug", () =>
    run(Effect.gen(function* () {
      const { documents, files } = yield* setup
      const a = path.join(files, "a", "report.md")
      const b = path.join(files, "b", "report.md")
      const first = yield* agent(documents.publish(publish({ body: "# Report\n\nOne.", sourcePath: a })))
      const again = yield* agent(documents.publish(publish({ body: "# Report\n\nOne, edited.", sourcePath: a })))
      expect(again.result).toMatchObject({ id: first.result.id, slug: "report", version: 2 })
      const other = yield* agent(documents.publish(publish({ body: "# Report\n\nAnother.", sourcePath: b })))
      expect(other.result).toMatchObject({ slug: "report-2", version: 1 })
      // No heading and no frontmatter: the title comes from the file name.
      const named = yield* agent(documents.publish(publish({ body: "Just text.", sourcePath: path.join(files, "weekly_summary.md") })))
      expect(named.result).toMatchObject({ title: "Weekly summary", slug: "weekly-summary", summary: "Just text." })
    })))

  it.effect("republishing what's already there changes nothing", () =>
    run(Effect.gen(function* () {
      const { documents } = yield* setup
      yield* agent(documents.publish(publish({ body: REPORT })))
      const input = publish({ body: REPORT, slug: "billing-audit" })
      const { result, seq } = yield* agent(documents.publish(input))
      expect(seq).toBeNull()
      expect(result).toMatchObject({ version: 1, body: REPORT })
      expect(yield* eventsOf(input.commandId)).toEqual([])
    })))

  it.effect("links tasks by key and only ever adds links; a link alone doesn't make a new version", () =>
    run(Effect.gen(function* () {
      const { documents, tasks, project } = yield* setup
      const { result: one } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Audit billing" })
      const { result: two } = yield* tasks.create({ commandId: cmd(), projectId: project.id, title: "Refund duplicates" })
      const first = yield* agent(documents.publish(publish({ body: REPORT, taskKeys: ["cel-1"] })))
      expect(first.result.tasks).toEqual([{ id: one.id, key: "CEL-1" }])

      const input = publish({ body: REPORT, slug: "billing-audit", taskKeys: ["CEL-2", "CEL-1"] })
      const linked = yield* agent(documents.publish(input))
      expect(linked.result).toMatchObject({ version: 1, tasks: [{ id: one.id, key: "CEL-1" }, { id: two.id, key: "CEL-2" }] })
      expect((yield* eventsOf(input.commandId)).map((e) => e.type)).toEqual(["document.updated"])

      const kept = yield* agent(documents.publish(publish({ body: `${REPORT}\n\nMore.`, slug: "billing-audit" })))
      expect(kept.result.tasks.map((t) => t.key)).toEqual(["CEL-1", "CEL-2"])
      expect((yield* documents.ofTask(two.id)).map((d) => d.slug)).toEqual(["billing-audit"])

      expect(yield* Effect.flip(agent(documents.publish(publish({ body: "# Other", taskKeys: ["CEL-99"] }))))).toMatchObject({
        _tag: "NotFound",
        entity: "task",
      })
      expect((yield* documents.list({ project: CEL })).documents.map((d) => d.slug)).toEqual(["billing-audit"])
    })))

  it.effect("copies files into the data folder and points the links at them; an unchanged file is stored once", () =>
    run(Effect.gen(function* () {
      const { documents, files } = yield* setup
      const assets = yield* AssetStore.AssetStore
      const reviews = yield* ReviewService.ReviewService
      fs.mkdirSync(path.join(files, "shots"))
      const png = writePng(path.join(files, "shots"), "board.png")
      const log = writeText(files, "vitest.log", "Tests  12 passed")
      const body = "# Shots\n\n![The board](shots/board.png)\n\n[The log](vitest.log) · ![Remote](https://example.com/a.png)"
      const source = path.join(files, "report.md")
      const { result } = yield* agent(documents.publish(publish({ body, sourcePath: source, files: [png, log] })))

      const ids = [...result.body.matchAll(/\/attachments\/(\w+)/g)].map((m) => m[1]!)
      expect(ids).toHaveLength(2)
      expect(result.body).toBe(`# Shots\n\n![The board](/attachments/${ids[0]})\n\n[The log](/attachments/${ids[1]}) · ![Remote](https://example.com/a.png)`)
      const image = yield* reviews.file(ids[0]!, "original")
      expect(image).toMatchObject({ mime: "image/png", bytes: fs.statSync(png).size })
      expect(fs.readFileSync(image.path)).toEqual(fs.readFileSync(png))
      expect(path.dirname(image.path)).toBe(path.join(assets.dir, "documents", result.id))

      // Unchanged: nothing new is stored, and the page doesn't change.
      const same = yield* agent(documents.publish(publish({ body, sourcePath: source, files: [png, log] })))
      expect(same.seq).toBeNull()
      expect(fs.readdirSync(path.join(assets.dir, "documents", result.id))).toHaveLength(2)

      // A changed image is a new file and a new version; the old version still shows the old one.
      fs.writeFileSync(png, Buffer.concat([fs.readFileSync(png), Buffer.from([0])]))
      const next = yield* agent(documents.publish(publish({ body, sourcePath: source, files: [png, log] })))
      expect(next.result.version).toBe(2)
      expect(next.result.body).not.toContain(ids[0]!)
      expect(next.result.body).toContain(`/attachments/${ids[1]}`)
      expect((yield* documents.get({ project: CEL, slug: "shots", version: 1 })).body).toContain(ids[0]!)
      expect((yield* reviews.file(ids[0]!, "original")).bytes).toBe(fs.statSync(png).size - 1)
    })))

  it.effect("refuses bad input and writes nothing", () =>
    run(Effect.gen(function* () {
      const { documents, files } = yield* setup
      const assets = yield* AssetStore.AssetStore
      const fails = (input: Partial<DocumentService.PublishDocument> & { body: string }) => Effect.flip(agent(documents.publish(publish(input))))
      expect(yield* fails({ body: "  \n" })).toMatchObject({ _tag: "Invalid", field: "body" })
      expect(yield* fails({ body: REPORT, slug: "Not A Slug" })).toMatchObject({ _tag: "Invalid", field: "slug" })
      expect(yield* fails({ body: REPORT, sourcePath: "report.md" })).toMatchObject({ _tag: "Invalid", field: "sourcePath" })
      expect(yield* fails({ body: REPORT, files: [path.join(files, "missing.png")] })).toMatchObject({
        _tag: "Invalid",
        field: "files",
        reason: `there's no file at ${path.join(files, "missing.png")}`,
      })
      expect(yield* fails({ body: REPORT, files: [writeText(files, "page.html", "<script>")] })).toMatchObject({ _tag: "Invalid", field: "files" })
      expect(yield* Effect.flip(agent(documents.publish({ commandId: cmd(), project: { key: "NOPE" }, body: REPORT })))).toMatchObject({
        _tag: "NotFound",
        entity: "project",
      })
      expect((yield* documents.list({ project: CEL })).documents).toEqual([])
      expect(fs.existsSync(path.join(assets.dir, "documents"))).toBe(false)
    })))
})

describe("kinds, lists and archiving", () => {
  it.effect("pages by default; the kind stays on republish unless given; the list is newest first and leaves archived ones out", () =>
    run(Effect.gen(function* () {
      const { documents } = yield* setup
      const later = TestClock.adjust("1 second")
      yield* agent(documents.publish(publish({ body: "# How it works", kind: "doc" })))
      yield* later
      yield* agent(documents.publish(publish({ body: "# Pages spec", kind: "spec" })))
      yield* later
      yield* agent(documents.publish(publish({ body: REPORT })))
      yield* later
      const kept = yield* agent(documents.publish(publish({ body: "# How it works\n\nUpdated.", slug: "how-it-works" })))
      expect(kept.result.kind).toBe("doc")

      expect((yield* documents.list({ project: CEL })).documents.map((d) => d.slug)).toEqual(["how-it-works", "billing-audit", "pages-spec"])
      expect((yield* documents.list({ project: CEL, kind: "spec" })).documents.map((d) => d.slug)).toEqual(["pages-spec"])

      const input = { commandId: cmd(), project: CEL, slug: "pages-spec" }
      const archived = yield* agent(documents.archive(input))
      expect(archived.result.archivedAt).not.toBeNull()
      expect((yield* eventsOf(input.commandId)).map((e) => e.type)).toEqual(["document.archived"])
      expect((yield* documents.list({ project: CEL })).documents.map((d) => d.slug)).toEqual(["how-it-works", "billing-audit"])
      // Its link still opens it; publishing it again brings it back.
      expect((yield* documents.get({ project: CEL, slug: "pages-spec" })).archivedAt).not.toBeNull()
      const back = yield* agent(documents.publish(publish({ body: "# Pages spec", slug: "pages-spec" })))
      expect(back.result).toMatchObject({ archivedAt: null, version: 1 })
      expect(yield* Effect.flip(documents.archive({ commandId: cmd(), project: CEL, slug: "nope" }))).toMatchObject({ _tag: "NotFound", entity: "document" })
    })))
})
