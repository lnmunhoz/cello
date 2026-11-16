// `cello task submit` against a real server with real files: the packet lands with its evidence copied
// into the data folder and the task in In Review. Moving to In Review without one is refused with a
// pointer to submit. Repeatable flags (--label, --step, --attach) take several values.
import * as fs from "node:fs"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { writeMp4, writePng, writeText } from "@cello/server/testing/media"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo } from "./cli.ts"

const SESSION = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const claude = { CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_PID: String(process.pid) }

const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port)
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })
  for (const name of ["M2", "ui", "cli"]) yield* human["label.create"]({ commandId: newCommandId(), projectId: project.id, name, color: "#26B5CE" })
  return {
    port,
    dataDir,
    repo,
    human,
    agent: cello({ port, env: claude, cwd: repo }),
    piped: (stdin: string) => cello({ port, env: claude, cwd: repo, stdin }),
  }
})

describe("cello task submit", () => {
  it.live("--label and other repeatable flags take several values", () =>
    Effect.gen(function* () {
      const { agent } = yield* setup
      const created = yield* agent("task", "create", "Labelled", "--label", "M2", "--label", "ui,cli", "--json")
      expect(created.failure).toBeNull()
      const labels = JSON.parse((yield* agent("task", "get", "CEL-1", "--json")).out).labels as Array<{ id: string; name: string }>
      const names = JSON.parse(created.out).result.labelIds.map((id: string) => labels.find((l) => l.id === id)!.name)
      expect(names.sort()).toEqual(["M2", "cli", "ui"])
    }).pipe(Effect.scoped))

  it.live("moving to In Review without a packet is refused and points at submit; submit carries the evidence there", () =>
    Effect.gen(function* () {
      const { agent, repo, dataDir, port } = yield* setup
      yield* agent("task", "create", "Review packets")
      yield* agent("task", "claim", "CEL-1")

      expect((yield* agent("task", "move", "CEL-1", "In Review")).failure).toBe(
        "CEL-1 needs a review packet before it goes to In Review. Submit one instead: " +
          "`cello task submit CEL-1 --summary \"what changed\" --step \"how to check it\" --attach demo.mp4`. See `cello guide`.",
      )

      fs.mkdirSync(path.join(repo, "e2e"))
      const video = writeMp4(path.join(repo, "e2e"), "flow.mp4", { codec: "h264" })
      writePng(repo, "board.png")
      writeText(repo, "vitest.log", "Tests  12 passed (12)")
      const submitted = yield* agent(
        "task", "submit", "CEL-1",
        "--summary", "Adds **review packets**",
        "--step", "Open /review", "--step", "Play the video, then approve",
        "--attach", "e2e/flow.mp4", "--caption", "The whole flow",
        "--attach", "board.png",
        "--attach", "vitest.log", "--caption", "Unit tests",
        "--link", "https://github.com/lnmunhoz/cello/pull/10", "--caption", "The PR",
      )
      expect(submitted).toEqual({
        out: [
          "Submitted CEL-1 for review  In Progress → In Review",
          "  2 steps · 1 video · 1 screenshot · 1 file · 1 link",
          `  Lucas reviews it at http://127.0.0.1:${port}/review`,
        ].join("\n"),
        failure: null,
      })

      const detail = JSON.parse((yield* agent("task", "get", "CEL-1", "--json")).out)
      expect(detail.task.statusId).toBe(detail.statuses.find((s: { name: string }) => s.name === "In Review").id)
      const [review] = detail.reviews
      expect(review).toMatchObject({ summary: "Adds **review packets**", steps: ["Open /review", "Play the video, then approve"], decision: null })
      expect(review.attachments.map((a: { kind: string; name: string; caption: string }) => [a.kind, a.name, a.caption])).toEqual([
        ["video", "flow.mp4", "The whole flow"],
        ["image", "board.png", ""],
        ["file", "vitest.log", "Unit tests"],
        ["link", "https://github.com/lnmunhoz/cello/pull/10", "The PR"],
      ])
      // Copied into the server's data folder, byte for byte.
      const stored = fs.readdirSync(path.join(dataDir, "assets", detail.task.id))
      expect(stored.filter((f) => f.endsWith(".mp4"))).toHaveLength(1)
      expect(stored.some((f) => f.endsWith(".poster.jpg"))).toBe(true)
      const copy = stored.find((f) => f.endsWith(".mp4"))!
      expect(fs.readFileSync(path.join(dataDir, "assets", detail.task.id, copy)).equals(fs.readFileSync(video))).toBe(true)

      // The text view shows the packet.
      const text = (yield* agent("task", "get", "CEL-1")).out
      expect(text).toContain("Review (open), submitted by Claude Code session 2fd0505c, just now")
      expect(text).toContain("    1. Open /review")
      expect(text).toContain("    flow.mp4 (video): The whole flow")
    }).pipe(Effect.scoped))

  // CEL-71: CEL-52 went back to In Progress by `cello task move`, and its packet stayed on the Review page.
  it.live("moving the task out of In Review withdraws its packet: gone from the open list, shown as withdrawn, in the activity", () =>
    Effect.gen(function* () {
      const { agent, human, repo } = yield* setup
      yield* agent("task", "create", "Filters")
      yield* agent("task", "claim", "CEL-1")
      writePng(repo, "board.png")
      yield* agent("task", "submit", "CEL-1", "--summary", "Filter panel", "--step", "Open the board", "--attach", "board.png")
      expect((yield* human["snapshot.get"]({})).reviews).toHaveLength(1)

      expect(yield* agent("task", "move", "CEL-1", "In Progress")).toMatchObject({ failure: null })

      // Nothing waits on Lucas any more: the snapshot the Review page loads has no open packet.
      expect((yield* human["snapshot.get"]({})).reviews).toEqual([])
      const detail = JSON.parse((yield* agent("task", "get", "CEL-1", "--json")).out)
      expect(detail.reviews.map((r: { decision: string | null }) => r.decision)).toEqual(["withdrawn"])
      const text = (yield* agent("task", "get", "CEL-1")).out
      expect(text).toContain("Review (withdrawn just now: Claude Code session 2fd0505c moved it to In Progress), submitted by Claude Code session 2fd0505c, just now")
      expect(text).toContain("Claude Code session 2fd0505c moved it from In Review to In Progress")
      // The withdrawal is an event of its own, by the session that moved the task.
      const context = JSON.parse((yield* agent("context", "--json")).out)
      expect(context.recent.slice(0, 2).map((a: { event: { type: string }; taskKey: string }) => [a.event.type, a.taskKey])).toEqual([
        ["task.moved", "CEL-1"],
        ["review.withdrawn", "CEL-1"],
      ])
      // Coming back to In Review takes a new packet.
      expect((yield* agent("task", "move", "CEL-1", "In Review")).failure).toContain("CEL-1 needs a review packet before it goes to In Review")
    }).pipe(Effect.scoped))

  it.live("the summary can come from stdin; missing files and stray captions fail with what to fix", () =>
    Effect.gen(function* () {
      const { agent, piped, repo } = yield* setup
      yield* agent("task", "create", "From stdin")
      writePng(repo, "shot.png")
      const fromStdin = yield* piped("## Summary\n\nWritten in a heredoc")("task", "submit", "CEL-1", "--summary-file", "-", "--step", "Look", "--attach", "shot.png", "--json")
      expect(fromStdin.failure).toBeNull()
      expect(JSON.parse(fromStdin.out).result.review.summary).toBe("## Summary\n\nWritten in a heredoc")

      expect((yield* agent("task", "submit", "CEL-1", "--summary", "x", "--step", "y", "--attach", "missing.mp4")).failure).toBe(
        `There's no file at ${path.join(repo, "missing.mp4")}.`,
      )
      expect((yield* agent("task", "submit", "CEL-1", "--summary", "x", "--step", "y", "--caption", "Stray", "--attach", "shot.png")).failure).toBe(
        "--caption describes the --attach or --link before it; put it after one.",
      )
      expect((yield* agent("task", "submit", "CEL-1", "--step", "y", "--attach", "shot.png")).failure).toBe(
        "Say what changed: --summary \"…\", or --summary-file - for markdown from stdin.",
      )
    }).pipe(Effect.scoped))
})
