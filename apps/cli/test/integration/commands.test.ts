// Test 8: every command against a real server, with text and --json output. The changes record the
// calling Claude Code session.
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import { APP_VERSION } from "@cello/shared/version"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo, UNDER_LOAD } from "./cli.ts"

const SESSION = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const claude = { CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_PID: String(process.pid), CLAUDE_CODE_ENTRYPOINT: "cli" }
const rival = { CLAUDE_CODE_SESSION_ID: "9f2c1a7b-rival", CLAUDE_PID: String(process.pid) }

/** A server with project CEL linked to a git repo and a "cli" label, set up by the human. */
const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port)
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })
  yield* human["label.create"]({ commandId: newCommandId(), projectId: project.id, name: "cli", color: "#26B5CE" })
  return {
    port,
    repo,
    agent: cello({ port, env: claude, cwd: path.join(repo, "src") }),
    other: cello({ port, env: rival, cwd: repo }),
    me: cello({ port, env: { CELLO_SESSION: "me" }, cwd: repo }),
    /** The agent, with `stdin` piped in. */
    piped: (stdin: string) => cello({ port, env: claude, cwd: repo, stdin }),
  }
})

const json = <T = any>(output: { out: string; failure: string | null }): T => {
  expect(output.failure).toBeNull()
  return JSON.parse(output.out) as T
}

describe("cello commands against a real server", () => {
  // UNDER_LOAD: twenty-five commands against the server, some running git (0.4 s idle, 5.4 s at load ~110).
  it.live("create, list, claim, comment, move, get and release, in text and --json", () =>
    Effect.gen(function* () {
      const { agent, other, piped } = yield* setup

      // create
      expect(yield* agent("task", "create", "Write the CLI", "--label", "cli", "--priority", "high", "--description", "All commands"))
        .toEqual({ out: "Created CEL-1  Todo  Write the CLI", failure: null })
      const second = json(yield* piped("Described\nfrom stdin")("task", "create", "From stdin", "--body-file", "-", "--status", "backlog", "--json"))
      expect(second.result).toMatchObject({ key: "CEL-2", title: "From stdin", description: "Described\nfrom stdin" })

      // list
      expect((yield* agent("task", "list")).out).toBe("CEL-1  Todo  Write the CLI")
      expect((yield* agent("task", "list", "--status", "Backlog")).out).toBe("CEL-2  Backlog  From stdin")
      expect(json(yield* agent("task", "list", "--json")).tasks.map((t: { key: string }) => t.key)).toEqual(["CEL-1"])
      expect((yield* agent("task", "list", "--mine")).out).toBe("No open tasks claimed by you in CEL.")

      // claim, and a second session refused
      expect(yield* agent("task", "claim", "CEL-1")).toEqual({ out: "Claimed CEL-1  In Progress  Write the CLI", failure: null })
      expect((yield* other("task", "claim", "CEL-1")).failure).toBe(
        "CEL-1 is claimed by Claude Code session 2fd0505c (active now). Pick another task or run `cello task get CEL-1`.",
      )
      expect((yield* agent("task", "list", "--mine")).out).toBe("CEL-1  In Progress  Write the CLI  · Claude Code session 2fd0505c")

      // comment, from an argument and from stdin
      expect(yield* agent("task", "comment", "CEL-1", "Halfway there")).toEqual({ out: "Commented on CEL-1", failure: null })
      const fromStdin = piped("## Notes\n\nFrom a heredoc")
      expect(json(yield* fromStdin("task", "comment", "CEL-1", "--body-file", "-", "--json")).result.body).toBe("## Notes\n\nFrom a heredoc")

      // move
      // (Moving to In Review takes a review packet: see submit.test.ts.)
      expect(yield* agent("task", "move", "CEL-1", "todo")).toEqual({ out: "Moved CEL-1  In Progress → Todo", failure: null })
      expect(json(yield* agent("task", "move", "CEL-1", "In Progress", "--json")).result.key).toBe("CEL-1")

      // get
      const detail = (yield* agent("task", "get", "CEL-1")).out
      expect(detail).toContain("CEL-1  Write the CLI")
      expect(detail).toContain("Status: In Progress · Priority: High · Labels: cli")
      expect(detail).toContain("Claimed by: Claude Code session 2fd0505c")
      expect(detail).toContain("All commands")
      expect(detail).toContain("Halfway there")
      expect(detail).toContain("Claude Code session 2fd0505c claimed it")
      const full = json(yield* agent("task", "get", "CEL-1", "--json"))
      const sessionId = full.task.assigneeSessionId
      expect(full.sessions).toMatchObject([{ id: sessionId, externalId: SESSION, clientName: "Claude Code", entrypoint: "cli" }])
      expect(full.task.createdBySessionId).toBe(sessionId)
      expect(full.history.map((e: { type: string; sessionId: string }) => [e.type, e.sessionId === sessionId])).toEqual([
        ["task.created", true],
        ["task.claimed", true],
        ["task.moved", true],
        ["task.moved", true],
      ])

      // release
      expect(yield* agent("task", "release", "CEL-1")).toEqual({ out: "Released CEL-1  In Progress  Write the CLI", failure: null })
      expect(json(yield* agent("task", "claim", "CEL-1", "--json")).result.assigneeSessionId).toBe(sessionId)
      expect(json(yield* agent("task", "release", "CEL-1", "--json")).result.assigneeSessionId).toBeNull()
    }).pipe(Effect.scoped), UNDER_LOAD)

  it.live("context starts a session: project, statuses, labels, claims and recent activity", () =>
    Effect.gen(function* () {
      const { agent, repo } = yield* setup
      yield* agent("task", "create", "Write the CLI")
      yield* agent("task", "claim", "CEL-1")
      const text = (yield* agent("context")).out
      expect(text).toContain(`Project   CEL · Cello · ${repo}`)
      expect(text).toContain("You       Claude Code session 2fd0505c")
      expect(text).toContain("Statuses  Todo · In Progress · Needs input · In Review · Done")
      expect(text).toContain("Labels    cli")
      expect(text).toContain("Claimed by you\n  CEL-1  In Progress  Write the CLI")
      expect(text).toMatch(/Recent activity\n  just now  CEL-1  Claude Code session 2fd0505c claimed it/)

      const ctx = json(yield* agent("context", "--json"))
      expect(ctx).toMatchObject({ project: { key: "CEL" }, session: { externalId: SESSION }, claimed: [{ key: "CEL-1" }] })
    }).pipe(Effect.scoped))

  it.live("claims the session lost show in its context: taken over, or ended by a human change", () =>
    Effect.gen(function* () {
      const { agent, me } = yield* setup
      yield* agent("task", "create", "Write the CLI")
      yield* agent("task", "create", "Write the docs")
      yield* agent("task", "claim", "CEL-1")
      yield* agent("task", "claim", "CEL-2")
      expect((yield* me("task", "claim", "CEL-1")).out).toBe("Claimed CEL-1  In Progress  Write the CLI")
      expect((yield* me("task", "move", "CEL-2", "Todo")).out).toBe("Moved CEL-2  In Progress → Todo")
      expect((yield* agent("context")).out).toContain(
        "Claims you lost\n  CEL-2  ended when Lucas changed it, just now\n  CEL-1  taken over by Lucas, just now",
      )
    }).pipe(Effect.scoped))

  it.live("whoami prints the identity as JSON; guide prints the conventions", () =>
    Effect.gen(function* () {
      const { agent, me, repo } = yield* setup
      const who = json(yield* agent("whoami"))
      expect(who).toMatchObject({
        variables: claude,
        headers: { "x-cello-session": SESSION, "x-cello-client": "Claude Code" },
        repoRoot: repo,
        server: { actor: { kind: "agent", name: "Claude Code" }, session: { externalId: SESSION }, project: { key: "CEL" } },
      })
      expect(json(yield* me("whoami")).server).toMatchObject({ actor: { kind: "human", name: "Lucas" }, session: null })
      // CEL-37: which build the CLI is, and which the server runs.
      expect(who.cli).toEqual({ version: APP_VERSION, commit: null })
      expect(who.server.build).toMatchObject({ version: APP_VERSION, commit: null, web: null })
      expect(who.server.build.startedAt).toBeLessThanOrEqual(Date.now())
      const guide = (yield* agent("guide")).out
      expect(guide).toContain("cello context")
      // Reports go into Cello as pages, and a page can travel in a review packet.
      expect(guide).toContain("cello doc publish report.md --task CEL-13")
      expect(guide).toContain("--link <page url>")
      // The guide is docs/cli.md, command reference included.
      expect(guide).toContain("### cello task submit")
    }).pipe(Effect.scoped))

  it.live("CEL-37: --version names the build the CLI was made from", () =>
    Effect.gen(function* () {
      const { port, repo } = yield* setup
      expect((yield* cello({ port, cwd: repo, build: { commit: "c602f25" } })("--version")).out).toContain(`${APP_VERSION} (build c602f25)`)
      expect((yield* cello({ port, cwd: repo, build: { commit: null } })("--version")).out).toContain(`${APP_VERSION} (build dev)`)
    }).pipe(Effect.scoped))

  it.live("errors say what to do next: unknown folder, unknown task, unknown status, no server", () =>
    Effect.gen(function* () {
      const { port, agent } = yield* setup
      const outside = cello({ port, env: claude, cwd: "/" })
      expect((yield* outside("task", "list")).failure).toBe(
        "This folder isn't in a git repository, so Cello can't tell the project. Pass --project KEY.",
      )
      expect((yield* outside("task", "list", "--project", "CEL")).out).toBe("No open tasks in CEL.")
      expect((yield* agent("task", "get", "CEL-42")).failure).toBe("No task CEL-42. Run `cello task list` to see open tasks.")
      yield* agent("task", "create", "Write the CLI")
      expect((yield* agent("task", "move", "CEL-1", "Doing")).failure).toBe(
        "No status named \"Doing\". Statuses: Backlog, Todo, In Progress, Needs input, In Review, Done, Canceled.",
      )
      const down = cello({ port: 1, env: claude, cwd: "/" })
      expect((yield* down("task", "get", "CEL-1")).failure).toBe("Cello isn't running on 127.0.0.1:1. Start it with `cello start`.")
    }).pipe(Effect.scoped))
})
