// Test 8: every command against a real server, with text and --json output. The changes record the
// calling Claude Code session. One server serves the whole file, each test with its own project and
// sessions: a server per test outlasted Vitest's 5 s on a loaded machine (CEL-121).
import { randomUUID } from "node:crypto"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { beforeAll, describe, expect, it } from "@effect/vitest"
import { APP_VERSION } from "@cello/shared/version"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo } from "./cli.ts"

let server: { readonly port: number; readonly dataDir: string; readonly human: Effect.Success<ReturnType<typeof connect>> }
beforeAll(() =>
  Effect.gen(function* () {
    const dataDir = yield* tempDataDir
    const { port } = yield* startServer(dataDir)
    server = { port, dataDir, human: yield* connect(port) }
  })
)

let projects = 0

/**
 * A project of its own (CELA, CELB, …) linked to a git repo, with a "cli" label, set up by the human;
 * a Claude Code session of its own (`short` is how Cello names it) and a rival one.
 */
const setup = Effect.gen(function* () {
  const { port, dataDir, human } = server
  const key = `CEL${String.fromCharCode(65 + projects++)}`
  const repo = gitRepo(dataDir, key.toLowerCase())
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key, repoPath: repo })
  yield* human["label.create"]({ commandId: newCommandId(), projectId: project.id, name: "cli", color: "#26B5CE" })
  const session = randomUUID()
  const claude = { CLAUDE_CODE_SESSION_ID: session, CLAUDE_PID: String(process.pid), CLAUDE_CODE_ENTRYPOINT: "cli" }
  return {
    port,
    repo,
    key,
    session,
    short: session.slice(0, 8),
    claude,
    agent: cello({ port, env: claude, cwd: path.join(repo, "src") }),
    other: cello({ port, env: { CLAUDE_CODE_SESSION_ID: randomUUID(), CLAUDE_PID: String(process.pid) }, cwd: repo }),
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
  it.live("create, from arguments and from stdin, in text and --json", () =>
    Effect.gen(function* () {
      const { agent, piped, key } = yield* setup
      expect(yield* agent("task", "create", "Write the CLI", "--label", "cli", "--priority", "high", "--description", "All commands"))
        .toEqual({ out: `Created ${key}-1  Todo  Write the CLI`, failure: null })
      const second = json(yield* piped("Described\nfrom stdin")("task", "create", "From stdin", "--body-file", "-", "--status", "backlog", "--json"))
      expect(second.result).toMatchObject({ key: `${key}-2`, title: "From stdin", description: "Described\nfrom stdin" })
    }).pipe(Effect.scoped))

  it.live("list: open tasks, by --status, as --json, and --mine", () =>
    Effect.gen(function* () {
      const { agent, key } = yield* setup
      yield* agent("task", "create", "Write the CLI")
      yield* agent("task", "create", "From stdin", "--status", "backlog")
      expect((yield* agent("task", "list")).out).toBe(`${key}-1  Todo  Write the CLI`)
      expect((yield* agent("task", "list", "--status", "Backlog")).out).toBe(`${key}-2  Backlog  From stdin`)
      expect(json(yield* agent("task", "list", "--json")).tasks.map((t: { key: string }) => t.key)).toEqual([`${key}-1`])
      expect((yield* agent("task", "list", "--mine")).out).toBe(`No open tasks claimed by you in ${key}.`)
    }).pipe(Effect.scoped))

  it.live("claim, a second session refused, and --mine lists it", () =>
    Effect.gen(function* () {
      const { agent, other, key, short, session } = yield* setup
      yield* agent("task", "create", "Write the CLI")
      expect(yield* agent("task", "claim", `${key}-1`)).toEqual({ out: `Claimed ${key}-1  In Progress  Write the CLI`, failure: null })
      expect((yield* other("task", "claim", `${key}-1`)).failure).toBe(
        `${key}-1 is claimed by Claude Code session ${short} (active now). Pick another task or run \`cello task get ${key}-1\`.`,
      )
      expect((yield* agent("task", "list", "--mine")).out).toBe(`${key}-1  In Progress  Write the CLI  · Claude Code session ${short}`)
    }).pipe(Effect.scoped))

  it.live("comment, from an argument and from stdin", () =>
    Effect.gen(function* () {
      const { agent, piped, key } = yield* setup
      yield* agent("task", "create", "Write the CLI")
      expect(yield* agent("task", "comment", `${key}-1`, "Halfway there")).toEqual({ out: `Commented on ${key}-1`, failure: null })
      const fromStdin = piped("## Notes\n\nFrom a heredoc")
      expect(json(yield* fromStdin("task", "comment", `${key}-1`, "--body-file", "-", "--json")).result.body).toBe("## Notes\n\nFrom a heredoc")
    }).pipe(Effect.scoped))

  it.live("move, in text and --json", () =>
    Effect.gen(function* () {
      const { agent, key } = yield* setup
      yield* agent("task", "create", "Write the CLI")
      yield* agent("task", "claim", `${key}-1`)
      // (Moving to In Review takes a review packet: see submit.test.ts.)
      expect(yield* agent("task", "move", `${key}-1`, "todo")).toEqual({ out: `Moved ${key}-1  In Progress → Todo`, failure: null })
      expect(json(yield* agent("task", "move", `${key}-1`, "In Progress", "--json")).result.key).toBe(`${key}-1`)
    }).pipe(Effect.scoped))

  it.live("get: the task, its comments and its history, each change by the calling session; --json too", () =>
    Effect.gen(function* () {
      const { agent, key, short, session } = yield* setup
      yield* agent("task", "create", "Write the CLI", "--label", "cli", "--priority", "high", "--description", "All commands")
      yield* agent("task", "claim", `${key}-1`)
      yield* agent("task", "comment", `${key}-1`, "Halfway there")
      yield* agent("task", "move", `${key}-1`, "todo")
      yield* agent("task", "move", `${key}-1`, "In Progress")
      const detail = (yield* agent("task", "get", `${key}-1`)).out
      expect(detail).toContain(`${key}-1  Write the CLI`)
      expect(detail).toContain("Status: In Progress · Priority: High · Labels: cli")
      expect(detail).toContain(`Claimed by: Claude Code session ${short}`)
      expect(detail).toContain("All commands")
      expect(detail).toContain("Halfway there")
      expect(detail).toContain(`Claude Code session ${short} claimed it`)
      const full = json(yield* agent("task", "get", `${key}-1`, "--json"))
      const sessionId = full.task.assigneeSessionId
      expect(full.sessions).toMatchObject([{ id: sessionId, externalId: session, clientName: "Claude Code", entrypoint: "cli" }])
      expect(full.task.createdBySessionId).toBe(sessionId)
      expect(full.history.map((e: { type: string; sessionId: string }) => [e.type, e.sessionId === sessionId])).toEqual([
        ["task.created", true],
        ["task.claimed", true],
        ["task.moved", true],
        ["task.moved", true],
      ])
    }).pipe(Effect.scoped))

  it.live("release, and claim again, in text and --json", () =>
    Effect.gen(function* () {
      const { agent, key } = yield* setup
      yield* agent("task", "create", "Write the CLI")
      const sessionId = json(yield* agent("task", "claim", `${key}-1`, "--json")).result.assigneeSessionId
      expect(yield* agent("task", "release", `${key}-1`)).toEqual({ out: `Released ${key}-1  In Progress  Write the CLI`, failure: null })
      expect(json(yield* agent("task", "claim", `${key}-1`, "--json")).result.assigneeSessionId).toBe(sessionId)
      expect(json(yield* agent("task", "release", `${key}-1`, "--json")).result.assigneeSessionId).toBeNull()
    }).pipe(Effect.scoped))

  it.live("context starts a session: project, statuses, labels, claims and recent activity", () =>
    Effect.gen(function* () {
      const { agent, repo, key, short, session } = yield* setup
      yield* agent("task", "create", "Write the CLI")
      yield* agent("task", "claim", `${key}-1`)
      const text = (yield* agent("context")).out
      expect(text).toContain(`Project   ${key} · Cello · ${repo}`)
      expect(text).toContain(`You       Claude Code session ${short}`)
      expect(text).toContain("Statuses  Todo · In Progress · Needs input · In Review · Done")
      expect(text).toContain("Labels    cli")
      expect(text).toContain(`Claimed by you\n  ${key}-1  In Progress  Write the CLI`)
      expect(text).toContain(`Recent activity\n  just now  ${key}-1  Claude Code session ${short} claimed it`)

      const ctx = json(yield* agent("context", "--json"))
      expect(ctx).toMatchObject({ project: { key }, session: { externalId: session }, claimed: [{ key: `${key}-1` }] })
    }).pipe(Effect.scoped))

  it.live("claims the session lost show in its context: taken over, or ended by a human change", () =>
    Effect.gen(function* () {
      const { agent, me, key } = yield* setup
      yield* agent("task", "create", "Write the CLI")
      yield* agent("task", "create", "Write the docs")
      yield* agent("task", "claim", `${key}-1`)
      yield* agent("task", "claim", `${key}-2`)
      expect((yield* me("task", "claim", `${key}-1`)).out).toBe(`Claimed ${key}-1  In Progress  Write the CLI`)
      expect((yield* me("task", "move", `${key}-2`, "Todo")).out).toBe(`Moved ${key}-2  In Progress → Todo`)
      expect((yield* agent("context")).out).toContain(
        `Claims you lost\n  ${key}-2  ended when Lucas changed it, just now\n  ${key}-1  taken over by Lucas, just now`,
      )
    }).pipe(Effect.scoped))

  it.live("whoami prints the identity as JSON; guide prints the conventions", () =>
    Effect.gen(function* () {
      const { agent, me, repo, key, session, claude } = yield* setup
      const who = json(yield* agent("whoami"))
      expect(who).toMatchObject({
        variables: claude,
        headers: { "x-cello-session": session, "x-cello-client": "Claude Code" },
        repoRoot: repo,
        server: { actor: { kind: "agent", name: "Claude Code" }, session: { externalId: session }, project: { key } },
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
      const { port, agent, key, claude } = yield* setup
      const outside = cello({ port, env: claude, cwd: "/" })
      expect((yield* outside("task", "list")).failure).toBe(
        "This folder isn't in a git repository, so Cello can't tell the project. Pass --project KEY.",
      )
      expect((yield* outside("task", "list", "--project", key)).out).toBe(`No open tasks in ${key}.`)
      expect((yield* agent("task", "get", `${key}-42`)).failure).toBe(`No task ${key}-42. Run \`cello task list\` to see open tasks.`)
      yield* agent("task", "create", "Write the CLI")
      expect((yield* agent("task", "move", `${key}-1`, "Doing")).failure).toBe(
        "No status named \"Doing\". Statuses: Backlog, Todo, In Progress, Needs input, In Review, Done, Canceled.",
      )
      const down = cello({ port: 1, env: claude, cwd: "/" })
      expect((yield* down("task", "get", `${key}-1`)).failure).toBe("Cello isn't running on 127.0.0.1:1. Start it with `cello start`.")
    }).pipe(Effect.scoped))
})
