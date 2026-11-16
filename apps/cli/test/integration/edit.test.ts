// CEL-63: `cello task edit CEL-n --title/--description/--body-file/--priority`, against a real server.
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo } from "./cli.ts"

const claude = { CLAUDE_CODE_SESSION_ID: "2fd0505c-417a-4167-acfe-2d66080fcae0", CLAUDE_PID: String(process.pid) }
const rival = { CLAUDE_CODE_SESSION_ID: "9f2c1a7b-rival", CLAUDE_PID: String(process.pid) }

/** Project CEL linked to a git repo, with CEL-1 "Sidebar" described "Old notes". */
const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port)
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })
  yield* human["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Sidebar", description: "Old notes" })
  return {
    human,
    agent: cello({ port, env: claude, cwd: path.join(repo, "src") }),
    other: cello({ port, env: rival, cwd: repo }),
    me: cello({ port, env: { CELLO_SESSION: "me" }, cwd: repo }),
    piped: (stdin: string) => cello({ port, env: claude, cwd: repo, stdin }),
  }
})

const task = (human: Effect.Success<typeof setup>["human"]) => Effect.map(human["task.get"]({ key: "CEL-1" }), (d) => d.task)

describe("cello task edit", () => {
  it.live("--title changes only the title", () =>
    Effect.gen(function* () {
      const { agent, human } = yield* setup
      expect(yield* agent("task", "edit", "cel-1", "--title", "Sidebar: collapse and resize"))
        .toEqual({ out: "Edited CEL-1  Sidebar: collapse and resize", failure: null })
      expect(yield* task(human)).toMatchObject({ title: "Sidebar: collapse and resize", description: "Old notes", version: 2 })
    }).pipe(Effect.scoped))

  it.live("--body-file - replaces the description with markdown from stdin; --json prints the write", () =>
    Effect.gen(function* () {
      const { piped, human } = yield* setup
      const output = yield* piped("## Plan\n\n- collapse\n- resize\n")("task", "edit", "CEL-1", "--body-file", "-", "--json")
      expect(output.failure).toBeNull()
      expect(JSON.parse(output.out).result).toMatchObject({ key: "CEL-1", title: "Sidebar", description: "## Plan\n\n- collapse\n- resize\n" })
      expect((yield* task(human)).description).toBe("## Plan\n\n- collapse\n- resize\n")
    }).pipe(Effect.scoped))

  it.live("title, description and priority together are one change, one line in the history", () =>
    Effect.gen(function* () {
      const { agent, human } = yield* setup
      expect(yield* agent("task", "edit", "CEL-1", "--title", "Sidebar v2", "--description", "New notes", "--priority", "high"))
        .toEqual({ out: "Edited CEL-1  Sidebar v2", failure: null })
      expect(yield* task(human)).toMatchObject({ title: "Sidebar v2", description: "New notes", priority: 2, version: 2 })
      const history = yield* human["task.history"]({ id: (yield* task(human)).id })
      expect(history.filter((e) => e.type === "task.updated")).toHaveLength(1)
      // The same values again change nothing.
      expect((yield* agent("task", "edit", "CEL-1", "--title", "Sidebar v2")).out).toBe("Nothing to change on CEL-1  Sidebar v2")
    }).pipe(Effect.scoped))

  it.live("with nothing to change it refuses and changes nothing", () =>
    Effect.gen(function* () {
      const { agent, human } = yield* setup
      expect(yield* agent("task", "edit", "CEL-1")).toEqual({
        out: "",
        failure: "Say what to change: cello task edit CEL-1 --title \"…\", --description \"…\" (or --body-file - for markdown from stdin), --priority high, or --milestone M3.",
      })
      expect((yield* agent("task", "edit", "CEL-1", "--priority", "asap")).failure)
        .toBe("No priority \"asap\". Use urgent, high, medium, low or none.")
      expect((yield* task(human)).version).toBe(1)
    }).pipe(Effect.scoped))

  it.live("an unknown key is refused like any other command's", () =>
    Effect.gen(function* () {
      const { agent } = yield* setup
      expect((yield* agent("task", "edit", "CEL-99", "--title", "Nope")).failure).toBe("No task CEL-99. Run `cello task list` to see open tasks.")
    }).pipe(Effect.scoped))

  it.live("isn't claim-gated: an agent may edit a task another session holds, which keeps its claim; Lucas's edit ends it", () =>
    Effect.gen(function* () {
      const { agent, other, me } = yield* setup
      yield* other("task", "claim", "CEL-1")
      expect((yield* agent("task", "edit", "CEL-1", "--title", "Sidebar, by another agent")).failure).toBeNull()
      expect((yield* agent("task", "get", "CEL-1")).out).toContain("Claimed by: Claude Code session 9f2c1a7b")
      expect((yield* me("task", "edit", "CEL-1", "--title", "Sidebar, by Lucas")).out).toBe("Edited CEL-1  Sidebar, by Lucas")
      expect((yield* other("context")).out).toContain("Claims you lost\n  CEL-1  ended when Lucas changed it")
    }).pipe(Effect.scoped))
})
