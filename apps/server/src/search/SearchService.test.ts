// One search for the ⌘K bar and `cello search` (CEL-11, CEL-43): words match the start of words and
// their stems, all of them required; a task key jumps to its task and finds what mentions it; results
// come grouped by kind, best first, with the matched words as ranges. The index follows every write
// path in the same transaction: creates, edits, deletes, archives and resubmits.
import type { SearchHit, SearchResults } from "@cello/contract/search"
import { segments } from "@cello/shared/search"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as CommentService from "../comment/CommentService.ts"
import * as DocumentService from "../document/DocumentService.ts"
import * as LabelService from "../label/LabelService.ts"
import * as ProjectService from "../project/ProjectService.ts"
import * as ReviewService from "../review/ReviewService.ts"
import * as TaskService from "../task/TaskService.ts"
import * as WorkspaceService from "../workspace/WorkspaceService.ts"
import { cmd, setupProject } from "../testing/fixtures.ts"
import { asAgent, asHuman, services } from "../testing/TestLayers.ts"
import * as SearchService from "./SearchService.ts"

const run = <A, E>(effect: Effect.Effect<A, E, any>) => asHuman(effect).pipe(Effect.provide(services({ ffmpeg: null })), Effect.scoped) as Effect.Effect<A, E>

/** Evidence a packet needs. */
const PR = { url: "https://github.com/lnmunhoz/cello/pull/1" }

const agent = asAgent({ session: "session-search", client: "Claude Code", pid: process.pid })

/** The seeded workspace, project CEL, and a way to search it and make tasks in it. */
const setup = Effect.gen(function* () {
  const { workspace, status, project } = yield* setupProject
  const tasks = yield* TaskService.TaskService
  const search = yield* SearchService.SearchService
  const find = (query: string, extra: Partial<SearchService.SearchQuery> = {}) => search.query({ query, workspaceId: workspace.id, ...extra })
  const task = (title: string, description = "", statusName = "Todo") =>
    tasks.create({ commandId: cmd(), projectId: project.id, title, description, statusId: status[statusName]!.id }).pipe(Effect.map((w) => w.result))
  return { workspace, status, project, tasks, search, find, task }
})

/** Each group's hits as `kind:key-or-title`, in order. */
const shape = (results: SearchResults) =>
  results.groups.map((g) => [g.kind, g.total, g.hits.map((h) => h.taskKey ?? h.title)] as const)

/** The matched pieces of a hit's text, e.g. ["Evidence"]. */
const marked = (text: string, ranges: SearchHit["textRanges"]) => segments(text, ranges).filter((s) => s.match).map((s) => s.text)

describe("SearchService.query", () => {
  it.effect("a word finds tasks, comments, packets and documents, grouped by kind; a title match ranks above a description match", () =>
    run(Effect.gen(function* () {
      const { find, task, project } = yield* setup
      const body = yield* task("Record the flow", "The evidence goes in the packet.")
      const title = yield* task("Evidence in review packets")
      yield* task("Unrelated", "Nothing to see")
      yield* (yield* CommentService.CommentService).add({ commandId: cmd(), taskId: body.id, body: "The evidence video stops early." })
      const claimed = yield* agent((yield* TaskService.TaskService).claim({ commandId: cmd(), key: title.key }))
      yield* agent((yield* ReviewService.ReviewService).submit({
        commandId: cmd(), key: claimed.result.key, summary: "Evidence plays inline", steps: ["Open the packet"], files: [], links: [PR],
      }))
      yield* agent((yield* DocumentService.DocumentService).publish({
        commandId: cmd(), project: { key: project.key }, body: "# Evidence videos\n\nHow they're made.", kind: "doc",
      }))

      const results = yield* find("evidence")
      expect(results).toMatchObject({ query: "evidence", terms: ["evidence"], key: null, jump: null })
      expect(shape(results)).toEqual([
        ["task", 2, [title.key, body.key]],
        ["comment", 1, [body.key]],
        ["packet", 1, [title.key]],
        ["document", 1, ["Evidence videos"]],
      ])
      const [titleHit, bodyHit] = results.groups[0]!.hits
      expect(titleHit).toMatchObject({ kind: "task", id: title.id, taskId: title.id, projectKey: "CEL", status: "In Review", titleRanges: [[0, 8]] })
      expect(bodyHit).toMatchObject({ title: "Record the flow", titleRanges: [], text: "The evidence goes in the packet.", textRanges: [[4, 12]] })
      const comment = results.groups[1]!.hits[0]!
      expect(comment).toMatchObject({ kind: "comment", title: "Record the flow", author: "Lucas", text: "The evidence video stops early." })
      expect(marked(comment.snippet, comment.snippetRanges)).toEqual(["evidence"])
      expect(results.groups[2]!.hits[0]).toMatchObject({ kind: "packet", author: "Claude Code", decision: null, text: "Evidence plays inline\nOpen the packet" })
      expect(results.groups[3]!.hits[0]).toMatchObject({ kind: "document", docKind: "doc", slug: "evidence-videos", taskId: null, titleRanges: [[0, 8]] })
    })))

  it.effect("as you type: every prefix of a word finds it, and every word is required", () =>
    run(Effect.gen(function* () {
      const { find, task } = yield* setup
      const t = yield* task("Evidence videos for the review")
      yield* task("Evidence only")
      for (const prefix of ["ev", "evi", "evid", "evide", "eviden", "evidenc", "evidence"]) {
        const hits = (yield* find(prefix)).groups[0]?.hits ?? []
        expect(hits.map((h) => h.id), prefix).toContain(t.id)
        expect(marked(hits.find((h) => h.id === t.id)!.title, hits.find((h) => h.id === t.id)!.titleRanges), prefix).toEqual(["Evidence"])
      }
      expect(shape(yield* find("evid vid"))).toEqual([["task", 1, [t.key]]])
      expect(shape(yield* find("evid nothing"))).toEqual([])
      expect(yield* find("  ")).toMatchObject({ terms: [], groups: [] })
    })))

  it.effect("stems: 'videos' finds 'video', 'running' finds 'runs', and accents fold", () =>
    run(Effect.gen(function* () {
      const { find, task } = yield* setup
      const video = yield* task("One video")
      const runs = yield* task("The hook runs after each tool call")
      const cafe = yield* task("Café flow")
      expect(shape(yield* find("videos"))).toEqual([["task", 1, [video.key]]])
      expect(shape(yield* find("running"))).toEqual([["task", 1, [runs.key]]])
      expect(shape(yield* find("cafe"))).toEqual([["task", 1, [cafe.key]]])
      const hit = (yield* find("videos")).groups[0]!.hits[0]!
      expect(marked(hit.title, hit.titleRanges)).toEqual(["video"])
    })))

  it.effect("a task key jumps to the task, and finds what mentions it or is on it; CEL-1 doesn't find CEL-15", () =>
    run(Effect.gen(function* () {
      const { find, task, tasks } = yield* setup
      const target = yield* task("Comments reach the agent")
      const mentions = yield* task("Review page", `Blocked on ${target.key}: the note has to reach the session.`)
      const unrelated = yield* task("Other", "Mentions CEL-15 only")
      const comments = yield* CommentService.CommentService
      yield* comments.add({ commandId: cmd(), taskId: target.id, body: "Started on this." })
      yield* comments.add({ commandId: cmd(), taskId: unrelated.id, body: `Same root cause as ${target.key.toLowerCase()}.` })

      const results = yield* find(` ${target.key.toLowerCase()} `)
      expect(results).toMatchObject({ key: target.key, terms: [] })
      expect(results.jump).toMatchObject({ kind: "task", id: target.id, taskKey: target.key, title: "Comments reach the agent" })
      expect(shape(results)).toEqual([
        ["task", 1, [mentions.key]],
        ["comment", 2, expect.arrayContaining([target.key, unrelated.key])],
      ])
      const hit = results.groups[0]!.hits[0]!
      expect(marked(hit.snippet, hit.snippetRanges)).toEqual([target.key])

      // A key with no task: no jump, still the mentions.
      expect(yield* find("CEL-999")).toMatchObject({ key: "CEL-999", jump: null, groups: [] })
      // An archived task isn't a place to jump to.
      yield* tasks.archive({ commandId: cmd(), id: target.id })
      expect((yield* find(target.key)).jump).toBeNull()
    })))

  it.effect("the index follows creates, edits, archives and deletes of tasks, comments, packets and documents", () =>
    run(Effect.gen(function* () {
      const { find, task, tasks, project, status } = yield* setup
      const ids = (query: string) => find(query).pipe(Effect.map((r) => r.groups.flatMap((g) => g.hits.map((h) => `${h.kind}:${h.id}`))))

      const t = yield* task("Sidebar resize")
      expect(yield* ids("sidebar")).toEqual([`task:${t.id}`])
      yield* tasks.update({ commandId: cmd(), id: t.id, expectedVersion: t.version, title: "Panel resize", description: "Drag its edge" })
      expect(yield* ids("sidebar")).toEqual([])
      expect(yield* ids("panel drag")).toEqual([`task:${t.id}`])
      yield* tasks.move({ commandId: cmd(), id: t.id, statusId: status["Done"]!.id })
      expect(yield* ids("panel")).toEqual([`task:${t.id}`])
      yield* tasks.archive({ commandId: cmd(), id: t.id })
      expect(yield* ids("panel")).toEqual([])
      yield* tasks.unarchive({ commandId: cmd(), id: t.id })
      expect(yield* ids("panel")).toEqual([`task:${t.id}`])

      const comments = yield* CommentService.CommentService
      const host = yield* task("Host")
      const { result: c } = yield* comments.add({ commandId: cmd(), taskId: host.id, body: "Trackpad swipe goes back" })
      expect(yield* ids("trackpad")).toEqual([`comment:${c.id}`])
      yield* comments.edit({ commandId: cmd(), id: c.id, body: "Mouse buttons go back" })
      expect(yield* ids("trackpad")).toEqual([])
      expect(yield* ids("mouse")).toEqual([`comment:${c.id}`])
      yield* comments.remove({ commandId: cmd(), id: c.id })
      expect(yield* ids("mouse")).toEqual([])
      // A comment on an archived task is left out with it.
      const { result: c2 } = yield* comments.add({ commandId: cmd(), taskId: host.id, body: "Zoom levels" })
      yield* tasks.archive({ commandId: cmd(), id: host.id })
      expect(yield* ids("zoom")).toEqual([])
      yield* tasks.unarchive({ commandId: cmd(), id: host.id })
      expect(yield* ids("zoom")).toEqual([`comment:${c2.id}`])

      const reviews = yield* ReviewService.ReviewService
      const packetTask = yield* task("Packets")
      yield* agent(tasks.claim({ commandId: cmd(), key: packetTask.key }))
      const first = yield* agent(reviews.submit({ commandId: cmd(), key: packetTask.key, summary: "Waveform first try", steps: ["Play it"], files: [], links: [PR] }))
      expect(yield* ids("waveform")).toEqual([`packet:${first.result.review.id}`])
      const second = yield* agent(reviews.submit({ commandId: cmd(), key: packetTask.key, summary: "Waveform second try", steps: ["Play it"], files: [], links: [PR] }))
      // The first was superseded: only the new one is found.
      expect(yield* ids("waveform")).toEqual([`packet:${second.result.review.id}`])
      yield* reviews.sendBack({ commandId: cmd(), key: packetTask.key, note: "The spectrogram is clipped" })
      // The note is on the packet (and Send back also leaves it as a comment).
      expect(yield* ids("spectrogram")).toContain(`packet:${second.result.review.id}`)
      expect((yield* find("waveform")).groups[0]!.hits[0]!.decision).toBe("sent_back")

      const documents = yield* DocumentService.DocumentService
      const { result: doc } = yield* agent(documents.publish({ commandId: cmd(), project: { key: project.key }, body: "# Restore guide\n\nStop the server first.", slug: "restore" }))
      expect(yield* ids("restore")).toEqual([`document:${doc.id}`])
      yield* agent(documents.publish({ commandId: cmd(), project: { key: project.key }, body: "# Recovery guide\n\nStop the server first.", slug: "restore" }))
      expect(yield* ids("restore")).toEqual([])
      expect(yield* ids("recovery")).toEqual([`document:${doc.id}`])
      yield* agent(documents.archive({ commandId: cmd(), project: { key: project.key }, slug: "restore" }))
      expect(yield* ids("recovery")).toEqual([])
    })))

  it.effect("ranks an open task above a Done one on a tie, then the newer first", () =>
    run(Effect.gen(function* () {
      const { find, task } = yield* setup
      const done = yield* task("Backup schedule", "", "Done")
      const older = yield* task("Backup schedule")
      const newer = yield* task("Backup schedule")
      expect(shape(yield* find("backup"))).toEqual([["task", 3, [newer.key, older.key, done.key]]])
    })))

  it.effect("searches one workspace, or one project; leaves out archived projects; finds projects and labels by name", () =>
    run(Effect.gen(function* () {
      const { find, task, workspace, search } = yield* setup
      const projects = yield* ProjectService.ProjectService
      const { result: thai } = yield* projects.create({ commandId: cmd(), workspaceId: workspace.id, name: "Thai Lookup", key: "THAI" })
      const { result: gone } = yield* projects.create({ commandId: cmd(), workspaceId: workspace.id, name: "Gone", key: "GONE" })
      const tasks = yield* TaskService.TaskService
      yield* task("Lookup speed")
      yield* tasks.create({ commandId: cmd(), projectId: thai.id, title: "Lookup cache" })
      yield* tasks.create({ commandId: cmd(), projectId: gone.id, title: "Lookup old" })
      yield* projects.archive({ commandId: cmd(), id: gone.id })
      const { result: other } = yield* (yield* WorkspaceService.WorkspaceService).create({ commandId: cmd(), name: "Work" })
      const { result: work } = yield* projects.create({ commandId: cmd(), workspaceId: other.id, name: "Work", key: "WRK" })
      yield* tasks.create({ commandId: cmd(), projectId: work.id, title: "Lookup elsewhere" })
      yield* (yield* LabelService.LabelService).create({ commandId: cmd(), workspaceId: workspace.id, name: "Lookups", color: "#22C55E" })

      const all = yield* find("lookup")
      expect(shape(all)).toEqual([
        ["task", 2, ["THAI-1", "CEL-1"]],
        ["project", 1, ["Thai Lookup"]],
        ["label", 1, ["Lookups"]],
      ])
      expect(all.groups[1]!.hits[0]).toMatchObject({ kind: "project", id: thai.id, projectKey: "THAI", titleRanges: [[5, 11]], color: thai.color })
      expect(all.groups[2]!.hits[0]).toMatchObject({ kind: "label", color: "#22C55E", titleRanges: [[0, 6]] })

      const one = yield* search.query({ query: "lookup", project: { key: "THAI" } })
      expect(shape(one)).toEqual([["task", 1, ["THAI-1"]], ["project", 1, ["Thai Lookup"]], ["label", 1, ["Lookups"]]])
      expect(shape(yield* search.query({ query: "lookup", workspaceId: other.id }))).toEqual([["task", 1, ["WRK-1"]]])
      // A project's key finds it too.
      expect(shape(yield* find("thai"))).toEqual([["project", 1, ["Thai Lookup"]]])
    })))

  it.effect("kinds narrow it, limit caps each group and total counts them all, and bad input is refused", () =>
    run(Effect.gen(function* () {
      const { find, task, search } = yield* setup
      for (let i = 0; i < 7; i++) yield* task(`Stage ${i}`)
      const capped = yield* find("stage")
      expect(capped.groups[0]).toMatchObject({ kind: "task", total: 7 })
      expect(capped.groups[0]!.hits).toHaveLength(5)
      expect((yield* find("stage", { limit: 50 })).groups[0]!.hits).toHaveLength(7)
      expect(yield* find("stage", { kinds: ["comment"] })).toMatchObject({ groups: [] })
      expect(yield* Effect.flip(find("stage", { limit: 0 }))).toMatchObject({ _tag: "Invalid", field: "limit" })
      expect(yield* Effect.flip(find("stage", { limit: 51 }))).toMatchObject({ _tag: "Invalid", field: "limit" })
      expect(yield* Effect.flip(search.query({ query: "stage" }))).toMatchObject({ _tag: "Invalid", field: "project" })
      expect(yield* Effect.flip(search.query({ query: "stage", workspaceId: "nope" }))).toMatchObject({ _tag: "NotFound", entity: "workspace" })
      expect(yield* Effect.flip(search.query({ query: "stage", project: { key: "NOPE" } }))).toMatchObject({ _tag: "NotFound" })
      // FTS5 syntax in a query is just words.
      expect(shape(yield* find(`"stage* OR NOT (x`))).toEqual([])
      expect((yield* find(`stage"`)).groups[0]!.total).toBe(7)
    })))

  it.effect("clips a long text around its first match", () =>
    run(Effect.gen(function* () {
      const { find, task } = yield* setup
      const filler = "lorem ipsum dolor sit amet ".repeat(200)
      yield* task("Long one", `${filler} the needle is here ${filler}`)
      const hit = (yield* find("needle")).groups[0]!.hits[0]!
      expect(hit.text.length).toBeLessThan(2100)
      expect(marked(hit.text, hit.textRanges)).toEqual(["needle"])
      expect(hit.snippet.length).toBeLessThan(260)
      expect(marked(hit.snippet, hit.snippetRanges)).toEqual(["needle"])
    })))
})
