// CEL-61: in a Cello project, `cello hook claude pre-tool-use` also runs before Claude Code's Edit,
// Write and NotebookEdit. Against a real server and a temp repo: an edit inside the repo is denied
// while the session holds no claimed task in the project, and goes through once it claims one.
// Everything it can't be sure of goes through silently: a file outside the repo, a server that's
// down or doesn't answer in time, a repo that isn't a Cello project, CELLO_ALLOW_UNTRACKED=1. The
// claim cache lives in a temp TMPDIR, never the real one.
//
// One server and repo serve the whole file (each test has its own sessions and TMPDIR, so nothing
// carries over), and the hook runs in this process; one test runs it as a real process, as Claude
// Code does. A process for every run, and a server per test, outlasted Vitest's 5 s on a loaded
// machine (CEL-121).
import { randomUUID } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { beforeAll, describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { claimDenyReason } from "../../src/claudeHook.ts"
import { cello, gitRepo, hookInProcess, hookProcess, installSetup, TEST_HOME, UNDER_LOAD } from "./cli.ts"

const claude = (session: string) => ({ CLAUDE_CODE_SESSION_ID: session, CLAUDE_PID: String(process.pid) })

/** Claude Code's PreToolUse input for a file-editing call. */
const editCall = (input: { session: string; cwd: string; tool?: string; toolInput: Record<string, unknown>; agentId?: string }) =>
  JSON.stringify({
    session_id: input.session,
    transcript_path: "/tmp/t.jsonl",
    cwd: input.cwd,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: input.tool ?? "Edit",
    tool_input: input.toolInput,
    tool_use_id: "toolu_01",
    ...(input.agentId ? { agent_id: input.agentId, agent_type: "cello-builder" } : {}),
  })

const SILENT = { exitCode: 0, stdout: "", stderr: "" }

const denied = (key: string) => ({
  exitCode: 0,
  stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: claimDenyReason(key) } })}\n`,
  stderr: "",
})

/** A port nothing listens on. */
const deadPort = () => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port
  probe.stop(true)
  return String(port)
}

/** A port that takes connections and never answers; closed when the scope closes. */
const silentPort = Effect.acquireRelease(
  Effect.sync(() => Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => {} } })),
  (listener) => Effect.sync(() => listener.stop(true)),
).pipe(Effect.map((listener) => String(listener.port)))

/** Project APP linked to a git repo "app" (one commit, so it can have worktrees), for the whole file. */
let world: { readonly port: number; readonly dataDir: string; readonly repo: string }
beforeAll(() =>
  Effect.gen(function* () {
    const dataDir = yield* tempDataDir
    const { port } = yield* startServer(dataDir)
    const repo = gitRepo(dataDir, "app")
    Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], { cwd: repo })
    const human = yield* connect(port)
    const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
    yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "App", key: "APP", repoPath: repo })
    world = { port, dataDir, repo }
  })
)

/** A test's own session (and another one) and TMPDIR: nothing claimed by them, nothing remembered. */
const setup = Effect.sync(() => {
  const { port, dataDir, repo } = world
  const tmp = fs.mkdtempSync(path.join(dataDir, "tmp-"))
  const session = randomUUID()
  // The deadline far past Vitest's, so a slow machine fails loudly instead of answering with the
  // deadline's silence (the deadline has its own test below).
  const env = { CELLO_PORT: String(port), HOME: TEST_HOME, TMPDIR: tmp, CELLO_HOOK_DEADLINE_MS: "60000" }
  const agent = cello({ port, env: claude(session), cwd: repo })
  return {
    port,
    dataDir,
    repo,
    tmp,
    env,
    session,
    other: randomUUID(),
    agent,
    /** This session's edit (or another tool's call, with `tool`). */
    call: (input: { cwd: string; tool?: string; toolInput: Record<string, unknown>; agentId?: string }) => editCall({ session, ...input }),
    /** Creates a task as the session and claims it; its key. */
    claimOne: (title: string) =>
      Effect.gen(function* () {
        const created = yield* agent("task", "create", title)
        const key = /Created (APP-\d+)/.exec(created.out)![1]!
        expect((yield* agent("task", "claim", key)).failure).toBeNull()
        return key
      }),
    hook: (stdin: string, extra: Record<string, string> = {}) => hookInProcess("pre-tool-use", { port, env: { ...env, ...extra }, cwd: dataDir }, stdin),
  }
})

describe("cello hook claude pre-tool-use: the claim guard", () => {
  it.live("denies Edit, Write and NotebookEdit in the repo while the session holds no claimed task; Bash is never guarded", () =>
    Effect.gen(function* () {
      const { repo, hook, call } = yield* setup
      expect(yield* hook(call({ cwd: repo, toolInput: { file_path: path.join(repo, "src", "a.ts"), old_string: "a", new_string: "b" } }))).toEqual(denied("APP"))
      // Write and NotebookEdit too, with a relative path.
      expect(yield* hook(call({ cwd: repo, tool: "Write", toolInput: { file_path: "src/new.ts", content: "" } }))).toEqual(denied("APP"))
      expect(yield* hook(call({ cwd: repo, tool: "NotebookEdit", toolInput: { notebook_path: path.join(repo, "n.ipynb"), new_source: "" } })))
        .toEqual(denied("APP"))
      // Reading, searching and running commands are never guarded.
      expect(yield* hook(call({ cwd: repo, tool: "Bash", toolInput: { command: "ls" } }))).toEqual(SILENT)
    }).pipe(Effect.scoped))

  it.live("lets the edit through once the session claims a task; another session's claim doesn't count", () =>
    Effect.gen(function* () {
      const { repo, hook, call, claimOne, other } = yield* setup
      yield* claimOne("Add the empty state")
      expect(yield* hook(call({ cwd: repo, toolInput: { file_path: path.join(repo, "src", "a.ts") } }))).toEqual(SILENT)
      expect(yield* hook(editCall({ session: other, cwd: repo, toolInput: { file_path: path.join(repo, "src", "a.ts") } }))).toEqual(denied("APP"))
    }).pipe(Effect.scoped))

  it.live("a subagent shares its parent's claim, also editing from a linked worktree of the repo", () =>
    Effect.gen(function* () {
      const { dataDir, repo, hook, call, claimOne } = yield* setup
      const worktree = path.join(dataDir, `app-wt-${randomUUID()}`)
      Bun.spawnSync(["git", "worktree", "add", "-q", worktree], { cwd: repo })
      const edit = call({ cwd: worktree, agentId: "a1", toolInput: { file_path: path.join(worktree, "src", "a.ts") } })
      expect(yield* hook(edit)).toEqual(denied("APP"))
      yield* claimOne("Builder work")
      expect(yield* hook(edit)).toEqual(SILENT)
    }).pipe(Effect.scoped))

  it.live("a file outside the repo (a scratchpad, a temp folder) goes through without a claim", () =>
    Effect.gen(function* () {
      const { tmp, repo, hook, call } = yield* setup
      const scratch = path.join(tmp, "scratchpad", "notes.md")
      expect(yield* hook(call({ cwd: repo, tool: "Write", toolInput: { file_path: scratch, content: "" } }))).toEqual(SILENT)
      expect(yield* hook(call({ cwd: repo, tool: "Write", toolInput: { file_path: "../app-sibling/x.ts", content: "" } }))).toEqual(SILENT)
    }).pipe(Effect.scoped))

  it.live("goes through silently when the server is down, the repo isn't a Cello project, or CELLO_ALLOW_UNTRACKED=1", () =>
    Effect.gen(function* () {
      const { tmp, repo, hook, call } = yield* setup
      const edit = call({ cwd: repo, toolInput: { file_path: path.join(repo, "src", "a.ts") } })
      expect(yield* hook(edit, { CELLO_PORT: deadPort() })).toEqual(SILENT)
      expect(yield* hook(edit, { CELLO_ALLOW_UNTRACKED: "1" })).toEqual(SILENT)

      const other = gitRepo(tmp, "not-cello")
      expect(yield* hook(call({ cwd: other, toolInput: { file_path: path.join(other, "a.ts") } }))).toEqual(SILENT)
      const plain = path.join(tmp, "plain")
      fs.mkdirSync(plain)
      expect(yield* hook(call({ cwd: plain, toolInput: { file_path: path.join(plain, "a.ts") } }))).toEqual(SILENT)
      // Broken input, or no session: nothing to go on.
      expect(yield* hook("{not json")).toEqual(SILENT)
      expect(yield* hook(JSON.stringify({ hook_event_name: "PreToolUse", cwd: repo, tool_name: "Edit", tool_input: { file_path: path.join(repo, "a.ts") } })))
        .toEqual(SILENT)
    }).pipe(Effect.scoped))

  it.live("goes through silently when the server doesn't answer within CELLO_HOOK_DEADLINE_MS", () =>
    Effect.gen(function* () {
      const { repo, hook, call } = yield* setup
      const port = yield* silentPort
      expect(yield* hook(call({ cwd: repo, toolInput: { file_path: path.join(repo, "src", "a.ts") } }), { CELLO_PORT: port, CELLO_HOOK_DEADLINE_MS: "100" }))
        .toEqual(SILENT)
    }).pipe(Effect.scoped))

  it.live("a deny is never remembered", () =>
    Effect.gen(function* () {
      const { repo, tmp, hook, call } = yield* setup
      expect(yield* hook(call({ cwd: repo, toolInput: { file_path: path.join(repo, "src", "a.ts") } }))).toEqual(denied("APP"))
      expect(fs.existsSync(path.join(tmp, "cello-claims"))).toBe(false)
    }).pipe(Effect.scoped))

  it.live("remembers a claim for a minute in TMPDIR, so the next edits don't ask the server", () =>
    Effect.gen(function* () {
      const { repo, tmp, hook, call, claimOne, agent } = yield* setup
      const edit = call({ cwd: repo, toolInput: { file_path: path.join(repo, "src", "a.ts") } })
      const key = yield* claimOne("Cached")
      expect(yield* hook(edit)).toEqual(SILENT)
      expect(fs.readdirSync(path.join(tmp, "cello-claims"))).toHaveLength(1)
      // With the claim remembered, the edit goes through without the server.
      yield* agent("task", "release", key)
      expect(yield* hook(edit)).toEqual(SILENT)
      // A fresh cache asks again and sees the release.
      fs.rmSync(path.join(tmp, "cello-claims"), { recursive: true })
      expect(yield* hook(edit)).toEqual(denied("APP"))
    }).pipe(Effect.scoped))

  it.live("Artifact calls still go to the artifact guard, which needs no claim and no server", () =>
    Effect.gen(function* () {
      const { repo, hook, call } = yield* setup
      const publish = call({ cwd: repo, tool: "Artifact", toolInput: { file_path: path.join(repo, "r.html") } })
      expect(JSON.parse((yield* hook(publish, { CELLO_PORT: deadPort() })).stdout).hookSpecificOutput.permissionDecisionReason)
        .toContain("This project uses Cello.")
    }).pipe(Effect.scoped))

  // UNDER_LOAD: the process is the point. Starting one loads the whole CLI: 0.3 s idle, 4.7 s at load ~110.
  it.live("as a real process, as Claude Code runs it: the server from its environment, the deny on stdout", () =>
    Effect.gen(function* () {
      const { repo, env, call } = yield* setup
      expect(yield* hookProcess("pre-tool-use", env, call({ cwd: repo, toolInput: { file_path: path.join(repo, "a.ts") } }))).toEqual(denied("APP"))
    }).pipe(Effect.scoped), UNDER_LOAD)
})

describe("cello install claude: the claim guard", () => {
  const GUARD = { matcher: "Artifact|AskUserQuestion|Edit|Write|NotebookEdit|Bash", hooks: [{ type: "command", command: "cello hook claude pre-tool-use", timeout: 10 }] }

  it.live("widens an older install's artifact guard to the edit tools; again changes nothing; uninstall takes it out", () =>
    Effect.gen(function* () {
      const { repo, run } = yield* installSetup
      const file = path.join(repo, ".claude", "settings.local.json")
      fs.mkdirSync(path.dirname(file))
      fs.writeFileSync(file, `${JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "cello hook claude stop", timeout: 10 }] }],
          PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "cello hook claude post-tool-use", timeout: 10 }] }],
          PreToolUse: [{ matcher: "Artifact", hooks: [{ type: "command", command: "cello hook claude pre-tool-use", timeout: 10 }] }],
        },
      }, null, 2)}\n`)

      const installed = yield* run(repo)("install", "claude")
      expect(installed.failure).toBeNull()
      expect(installed.out).toContain("Agents here can't edit files in the repo until their session has claimed a Cello task")
      expect(JSON.parse(fs.readFileSync(file, "utf8")).hooks.PreToolUse).toEqual([GUARD])

      const after = fs.readFileSync(file, "utf8")
      // The second line is the plugin's (CEL-64).
      expect((yield* run(repo)("install", "claude")).out.split("\n")[0]).toBe(`Cello's Claude Code hooks are already in ${file}.`)
      expect(fs.readFileSync(file, "utf8")).toBe(after)

      expect((yield* run(repo)("uninstall", "claude")).failure).toBeNull()
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({})
    }).pipe(Effect.scoped))
})
