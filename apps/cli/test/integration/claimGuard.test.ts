// CEL-61: in a Cello project, `cello hook claude pre-tool-use` also runs before Claude Code's Edit,
// Write and NotebookEdit. Against a real server and a temp repo, as a real process: an edit inside the
// repo is denied while the session holds no claimed task in the project, and goes through once it
// claims one. Everything it can't be sure of goes through silently: a file outside the repo, a server
// that's down, a repo that isn't a Cello project, CELLO_ALLOW_UNTRACKED=1. The claim cache lives in a
// temp TMPDIR, never the real one.
import * as fs from "node:fs"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { claimDenyReason } from "../../src/claudeHook.ts"
import { cello, gitRepo, hookProcess, installSetup, TEST_HOME } from "./cli.ts"

const X = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const Y = "9f2c1a7b-other-session"
const claude = (session: string) => ({ CLAUDE_CODE_SESSION_ID: session, CLAUDE_PID: String(process.pid) })

/** Claude Code's PreToolUse input for a file-editing call. */
const editCall = (input: { session?: string; cwd: string; tool?: string; toolInput: Record<string, unknown>; agentId?: string }) =>
  JSON.stringify({
    session_id: input.session ?? X,
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

/** Project APP linked to a git repo "app"; nobody has claimed anything. The hook runs as a real process. */
const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const repo = gitRepo(dataDir, "app")
  const human = yield* connect(port)
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "App", key: "APP", repoPath: repo })
  const tmp = path.join(dataDir, "tmp")
  fs.mkdirSync(tmp)
  const env = { CELLO_PORT: String(port), HOME: TEST_HOME, TMPDIR: tmp }
  return {
    port,
    dataDir,
    repo,
    tmp,
    env,
    agent: (session: string) => cello({ port, env: claude(session), cwd: repo }),
    hook: (stdin: string, extra: Record<string, string> = {}) => hookProcess("pre-tool-use", { ...env, ...extra }, stdin),
  }
})

describe("cello hook claude pre-tool-use: the claim guard", () => {
  it.live("denies an edit in the repo until the session claims a task, then lets it through", () =>
    Effect.gen(function* () {
      const { repo, hook, agent } = yield* setup
      const edit = editCall({ cwd: repo, toolInput: { file_path: path.join(repo, "src", "a.ts"), old_string: "a", new_string: "b" } })
      expect(yield* hook(edit)).toEqual(denied("APP"))
      // Write and NotebookEdit too, with a relative path.
      expect(yield* hook(editCall({ cwd: repo, tool: "Write", toolInput: { file_path: "src/new.ts", content: "" } }))).toEqual(denied("APP"))
      expect(yield* hook(editCall({ cwd: repo, tool: "NotebookEdit", toolInput: { notebook_path: path.join(repo, "n.ipynb"), new_source: "" } })))
        .toEqual(denied("APP"))
      // Reading, searching and running commands are never guarded.
      expect(yield* hook(editCall({ cwd: repo, tool: "Bash", toolInput: { command: "ls" } }))).toEqual(SILENT)

      expect((yield* agent(X)("task", "create", "Add the empty state")).failure).toBeNull()
      expect((yield* agent(X)("task", "claim", "APP-1")).failure).toBeNull()
      expect(yield* hook(edit)).toEqual(SILENT)
      // Another session's claim doesn't count for this one.
      expect(yield* hook(editCall({ session: Y, cwd: repo, toolInput: { file_path: path.join(repo, "src", "a.ts") } }))).toEqual(denied("APP"))
    }).pipe(Effect.scoped))

  it.live("a subagent shares its parent's claim, also editing from a linked worktree of the repo", () =>
    Effect.gen(function* () {
      const { dataDir, repo, hook, agent } = yield* setup
      const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo })
      git("commit", "-q", "--allow-empty", "-m", "init")
      const worktree = path.join(dataDir, "app-wt")
      git("worktree", "add", "-q", worktree)
      const edit = editCall({ cwd: worktree, agentId: "a1", toolInput: { file_path: path.join(worktree, "src", "a.ts") } })
      expect(yield* hook(edit)).toEqual(denied("APP"))
      yield* agent(X)("task", "create", "Builder work")
      yield* agent(X)("task", "claim", "APP-1")
      expect(yield* hook(edit)).toEqual(SILENT)
    }).pipe(Effect.scoped))

  it.live("a file outside the repo (a scratchpad, a temp folder) goes through without a claim", () =>
    Effect.gen(function* () {
      const { dataDir, repo, hook } = yield* setup
      const scratch = path.join(dataDir, "scratchpad", "notes.md")
      expect(yield* hook(editCall({ cwd: repo, tool: "Write", toolInput: { file_path: scratch, content: "" } }))).toEqual(SILENT)
      expect(yield* hook(editCall({ cwd: repo, tool: "Write", toolInput: { file_path: "../app-sibling/x.ts", content: "" } }))).toEqual(SILENT)
    }).pipe(Effect.scoped))

  it.live("goes through silently when the server is down, the repo isn't a Cello project, or CELLO_ALLOW_UNTRACKED=1", () =>
    Effect.gen(function* () {
      const { dataDir, repo, hook } = yield* setup
      const edit = editCall({ cwd: repo, toolInput: { file_path: path.join(repo, "src", "a.ts") } })
      expect(yield* hook(edit, { CELLO_PORT: deadPort() })).toEqual(SILENT)
      expect(yield* hook(edit, { CELLO_ALLOW_UNTRACKED: "1" })).toEqual(SILENT)

      const other = gitRepo(dataDir, "not-cello")
      expect(yield* hook(editCall({ cwd: other, toolInput: { file_path: path.join(other, "a.ts") } }))).toEqual(SILENT)
      const plain = path.join(dataDir, "plain")
      fs.mkdirSync(plain)
      expect(yield* hook(editCall({ cwd: plain, toolInput: { file_path: path.join(plain, "a.ts") } }))).toEqual(SILENT)
      // Broken input, or no session: nothing to go on.
      expect(yield* hook("{not json")).toEqual(SILENT)
      expect(yield* hook(JSON.stringify({ hook_event_name: "PreToolUse", cwd: repo, tool_name: "Edit", tool_input: { file_path: path.join(repo, "a.ts") } })))
        .toEqual(SILENT)
    }).pipe(Effect.scoped))

  it.live("remembers a claim for a minute in TMPDIR, so the next edits don't ask the server; a deny is never remembered", () =>
    Effect.gen(function* () {
      const { repo, tmp, hook, agent, env } = yield* setup
      const edit = editCall({ cwd: repo, toolInput: { file_path: path.join(repo, "src", "a.ts") } })
      expect(yield* hook(edit)).toEqual(denied("APP"))
      expect(fs.existsSync(path.join(tmp, "cello-claims"))).toBe(false)
      yield* agent(X)("task", "create", "Cached")
      yield* agent(X)("task", "claim", "APP-1")
      expect(yield* hook(edit)).toEqual(SILENT)
      expect(fs.readdirSync(path.join(tmp, "cello-claims"))).toHaveLength(1)
      // With the claim remembered, the edit goes through without the server.
      yield* agent(X)("task", "release", "APP-1")
      expect(yield* hook(edit)).toEqual(SILENT)
      // A fresh cache asks again and sees the release.
      fs.rmSync(path.join(tmp, "cello-claims"), { recursive: true })
      expect(yield* hook(edit, { TMPDIR: env.TMPDIR })).toEqual(denied("APP"))
    }).pipe(Effect.scoped))

  it.live("Artifact calls still go to the artifact guard, which needs no claim and no server", () =>
    Effect.gen(function* () {
      const { repo, hook } = yield* setup
      const publish = editCall({ cwd: repo, tool: "Artifact", toolInput: { file_path: path.join(repo, "r.html") } })
      expect(JSON.parse((yield* hook(publish, { CELLO_PORT: deadPort() })).stdout).hookSpecificOutput.permissionDecisionReason)
        .toContain("This project uses Cello.")
    }).pipe(Effect.scoped))

  it.live("in process, the same answer, so `cello hook claude` needs no real Claude Code", () =>
    Effect.gen(function* () {
      const { port, repo, tmp } = yield* setup
      const out = yield* cello({ port, env: { TMPDIR: tmp }, cwd: repo, stdin: editCall({ cwd: repo, toolInput: { file_path: path.join(repo, "a.ts") } }) })(
        "hook",
        "claude",
        "pre-tool-use",
      )
      expect(out.failure).toBeNull()
      expect(JSON.parse(out.out).hookSpecificOutput.permissionDecisionReason).toBe(claimDenyReason("APP"))
    }).pipe(Effect.scoped))
})

describe("cello install claude: the claim guard", () => {
  const GUARD = { matcher: "Artifact|Edit|Write|NotebookEdit", hooks: [{ type: "command", command: "cello hook claude pre-tool-use", timeout: 10 }] }

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
