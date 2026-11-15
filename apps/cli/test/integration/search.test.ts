// `cello search` against a real server (CEL-11): an agent finds tasks, comments, packets and pages in
// its project, grouped, with the matched words bracketed; a key prints the task and what mentions it;
// --kind, --limit and --json; a bad --kind names the real ones.
import { newCommandId } from "@cello/client/client"
import type { SearchResults } from "@cello/contract/search"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo } from "./cli.ts"

const claude = { CLAUDE_CODE_SESSION_ID: "2fd0505c-417a-4167-acfe-2d66080fcae0", CLAUDE_PID: String(process.pid) }

const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port)
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })
  return { agent: cello({ port, env: claude, cwd: repo }), human }
})

describe("cello search", () => {
  it.live("finds tasks and comments in the working folder's project, grouped, matches in brackets; a key jumps", () =>
    Effect.gen(function* () {
      const { agent } = yield* setup
      yield* agent("task", "create", "Evidence videos in review", "--description", "Recorded in review mode.")
      yield* agent("task", "create", "Record the flow", "--description", "The evidence goes in the packet. See CEL-1.")
      yield* agent("task", "comment", "CEL-1", "Re-recorded the evidence, slower.")

      const found = yield* agent("search", "evidence")
      expect(found.failure).toBeNull()
      expect(found.out.split("\n")).toEqual([
        "Tasks (2)",
        "  CEL-1  Todo  [Evidence] videos in review",
        "  CEL-2  Todo  Record the flow",
        "         The [evidence] goes in the packet. See CEL-1.",
        "Comments (1)",
        "  CEL-1  Claude Code, just now, on Evidence videos in review",
        "         Re-recorded the [evidence], slower.",
      ])
      // Several words: all of them, as prefixes.
      expect((yield* agent("search", "evid", "slow")).out.split("\n")[0]).toBe("Comments (1)")

      expect((yield* agent("search", "cel-1")).out.split("\n")).toEqual([
        "CEL-1  Todo  Evidence videos in review",
        "",
        "Mentions CEL-1",
        "Tasks (1)",
        "  CEL-2  Todo  Record the flow",
        "         The evidence goes in the packet. See [CEL-1].",
        "Comments (1)",
        "  CEL-1  Claude Code, just now, on Evidence videos in review",
        "         Re-recorded the evidence, slower.",
      ])
    }).pipe(Effect.scoped))

  it.live("--kind, --limit, --project and --json; nothing found and a bad kind say what to do", () =>
    Effect.gen(function* () {
      const { agent } = yield* setup
      for (let i = 1; i <= 7; i++) yield* agent("task", "create", `Stage ${i}`)
      yield* agent("task", "comment", "CEL-1", "Stage chips are loud")

      const limited = (yield* agent("search", "stage", "--limit", "2")).out.split("\n")
      // Most recent activity first: the comment on CEL-1 counts (CEL-5), then the newest task.
      expect(limited.slice(0, 3)).toEqual(["Tasks (2 of 7)", "  CEL-1  Todo  [Stage] 1", "  CEL-7  Todo  [Stage] 7"])
      expect(limited.at(-1)).toBe("More: `--limit 20` shows more per kind; `--kind task` shows only one kind.")
      expect((yield* agent("search", "stage", "--kind", "comment")).out.split("\n")[0]).toBe("Comments (1)")

      const json = JSON.parse((yield* agent("search", "stage", "--json", "--kind", "task", "--limit", "1")).out) as SearchResults
      expect(json).toMatchObject({ query: "stage", terms: ["stage"], key: null, jump: null })
      expect(json.groups).toEqual([expect.objectContaining({ kind: "task", total: 7, hits: [expect.objectContaining({ taskKey: "CEL-1", titleRanges: [[0, 5]] })] })])

      expect((yield* agent("search", "zebra")).out).toBe(
        "Nothing in this project matches \"zebra\". Search looks at task keys, titles and descriptions, comments, review packets, docs, projects and labels.",
      )
      expect((yield* agent("search", "zebra", "--project", "cel")).out).toContain("Nothing in CEL matches")
      expect((yield* agent("search", "stage", "--kind", "issue")).failure).toBe('No kind "issue". Kinds: task, comment, packet, page, project, label.')
      expect((yield* agent("search", "stage", "--limit", "99")).failure).toContain("limit")
    }).pipe(Effect.scoped))
})
