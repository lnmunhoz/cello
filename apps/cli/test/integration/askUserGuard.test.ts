// CEL-124: Claude's own AskUserQuestion dialog blocks a session until someone answers it, which once left
// a session stuck for 40 minutes. In a Cello project the PreToolUse hook denies it where nobody watches
// the window, pointing to `cello task ask`: a session in orchestrate mode (`cello sessions orchestrate
// on`, which /cello:orchestrate runs), a subagent, a run Cello woke. A session chatting with Lucas keeps
// the dialog, and so does every session when the server is down or slow, or the repo isn't a Cello
// project. Against a real server and a temp repo; settings files live in temp folders with a temp HOME
// (never the real ~/.claude).
//
// One server and repo serve the whole file (each test has its own sessions); the hook runs in this
// process, and one test runs it as a real process, as Claude Code does (CEL-121: a process per run
// outlasts Vitest's 5 s on a loaded machine).
import { randomUUID } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { beforeAll, describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { ASK_USER_DENY_REASON } from "../../src/claudeHook.ts"
import { cello, gitRepo, hookInProcess, hookProcess, installSetup, TEST_HOME, UNDER_LOAD } from "./cli.ts"

const GUARD = { matcher: "Artifact|AskUserQuestion|Edit|Write|NotebookEdit", hooks: [{ type: "command", command: "cello hook claude pre-tool-use", timeout: 10 }] }

const SILENT = { exitCode: 0, stdout: "", stderr: "" }
const DENIED = {
  exitCode: 0,
  stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: ASK_USER_DENY_REASON } })}\n`,
  stderr: "",
}

/** Claude Code's PreToolUse input for an AskUserQuestion call. */
const askCall = (input: { session: string; cwd: string; agentId?: string }) =>
  JSON.stringify({
    session_id: input.session,
    transcript_path: "/tmp/t.jsonl",
    cwd: input.cwd,
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: "AskUserQuestion",
    tool_input: { questions: [{ question: "Merge CEL-109?", header: "Merge", multiSelect: false, options: [{ label: "Merge it" }, { label: "Wait" }] }] },
    tool_use_id: "toolu_01",
    ...(input.agentId ? { agent_id: input.agentId, agent_type: "cello-builder" } : {}),
  })

/** A port nothing listens on. */
const deadPort = () => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port
  probe.stop(true)
  return String(port)
}

/** Project APP linked to a git repo "app", and a git repo "elsewhere" that's no project, for the whole file. */
let world: { readonly port: number; readonly dataDir: string; readonly repo: string; readonly elsewhere: string }
beforeAll(() =>
  Effect.gen(function* () {
    const dataDir = yield* tempDataDir
    const { port } = yield* startServer(dataDir)
    const repo = gitRepo(dataDir, "app")
    const human = yield* connect(port)
    const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
    yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "App", key: "APP", repoPath: repo })
    world = { port, dataDir, repo, elsewhere: gitRepo(dataDir, "elsewhere") }
  })
)

/** A test's own session, its `cello` commands, and its hook in this process. */
const setup = Effect.sync(() => {
  const { port, dataDir, repo, elsewhere } = world
  const session = randomUUID()
  // The deadline far past Vitest's, so a slow machine fails loudly instead of answering with the deadline's silence.
  const env = { CELLO_PORT: String(port), HOME: TEST_HOME, CELLO_HOOK_DEADLINE_MS: "60000" }
  const agent = cello({ port, env: { CLAUDE_CODE_SESSION_ID: session, CLAUDE_PID: String(process.pid) }, cwd: repo })
  return {
    port,
    repo,
    elsewhere,
    env,
    session,
    agent,
    call: (input: { cwd?: string; agentId?: string; session?: string } = {}) => askCall({ session, cwd: repo, ...input }),
    hook: (stdin: string, extra: Record<string, string> = {}) => hookInProcess("pre-tool-use", { port, env: { ...env, ...extra }, cwd: dataDir }, stdin),
  }
})

describe("cello hook claude pre-tool-use: AskUserQuestion", () => {
  it.live("a session chatting in the terminal keeps the dialog; orchestrating, it's denied; after off, it's back at once", () =>
    Effect.gen(function* () {
      const { hook, call, agent } = yield* setup
      expect(yield* hook(call())).toEqual(SILENT)

      const on = yield* agent("sessions", "orchestrate", "on")
      expect(on.failure).toBeNull()
      expect(on.out).toContain("This session is orchestrating")
      expect(yield* hook(call())).toEqual(DENIED)
      // Another session chatting in the same repo isn't orchestrating.
      expect(yield* hook(call({ session: randomUUID() }))).toEqual(SILENT)
      // `cello context` says so.
      expect((yield* agent("context")).out).toMatch(/^You {7}Claude Code session [0-9a-f]{8} · orchestrating$/m)

      expect((yield* agent("sessions", "orchestrate", "off")).out).toContain("This session stopped orchestrating")
      // Nothing remembered: the next call asks again.
      expect(yield* hook(call())).toEqual(SILENT)
      expect((yield* agent("context")).out).not.toContain("orchestrating")
    }))

  it.live("a subagent or a run Cello woke: denied without a server; a chat with the server down still keeps the dialog", () =>
    Effect.gen(function* () {
      const { hook, call } = yield* setup
      const down = { CELLO_PORT: deadPort() }
      expect(yield* hook(call({ agentId: "a13bfb89" }), down)).toEqual(DENIED)
      expect(yield* hook(call(), { ...down, CELLO_WOKEN: "1" })).toEqual(DENIED)
      expect(yield* hook(call(), down)).toEqual(SILENT)
    }))

  it.live("goes through while orchestrating in a repo that isn't a Cello project, or with CELLO_ALLOW_ASK_USER=1", () =>
    Effect.gen(function* () {
      const { hook, call, agent, elsewhere } = yield* setup
      expect((yield* agent("sessions", "orchestrate", "on")).failure).toBeNull()
      expect(yield* hook(call({ cwd: elsewhere }))).toEqual(SILENT)
      expect(yield* hook(call(), { CELLO_ALLOW_ASK_USER: "1" })).toEqual(SILENT)
      expect(yield* hook(call({ agentId: "a1" }), { CELLO_ALLOW_ASK_USER: "1" })).toEqual(SILENT)
    }))

  it.live("the human has no session to put in orchestrate mode", () =>
    Effect.gen(function* () {
      const { port, repo } = yield* setup
      const human = yield* cello({ port, env: {}, cwd: repo })("sessions", "orchestrate", "on")
      expect(human.failure).toContain("Orchestrate mode is for an agent session")
    }))

  // UNDER_LOAD: the process is the point. Starting one loads the whole CLI.
  it.live("as a real process, as Claude Code runs it: orchestrating is denied on stdout; exit 0", () =>
    Effect.gen(function* () {
      const { call, agent, env } = yield* setup
      expect((yield* agent("sessions", "orchestrate", "on")).failure).toBeNull()
      expect(yield* hookProcess("pre-tool-use", env, call())).toEqual(DENIED)
    }), UNDER_LOAD)
})

describe("cello install claude: the AskUserQuestion guard", () => {
  it.live("adds AskUserQuestion to an older install's guard (Artifact and the edit tools); again changes nothing; uninstall takes it out", () =>
    Effect.gen(function* () {
      const { repo, run } = yield* installSetup
      const file = path.join(repo, ".claude", "settings.local.json")
      fs.mkdirSync(path.dirname(file))
      fs.writeFileSync(file, `${JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "cello hook claude stop", timeout: 10 }] }],
          PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "cello hook claude post-tool-use", timeout: 10 }] }],
          PreToolUse: [{ matcher: "Artifact|Edit|Write|NotebookEdit", hooks: [{ type: "command", command: "cello hook claude pre-tool-use", timeout: 10 }] }],
        },
      }, null, 2)}\n`)

      const installed = yield* run(repo)("install", "claude")
      expect(installed.failure).toBeNull()
      expect(installed.out).toContain("Orchestrating sessions, subagents and runs Cello woke can't ask you questions in Claude's own window")
      expect(JSON.parse(fs.readFileSync(file, "utf8")).hooks.PreToolUse).toEqual([GUARD])

      const after = fs.readFileSync(file, "utf8")
      // The second line is the plugin's (CEL-64).
      expect((yield* run(repo)("install", "claude")).out.split("\n")[0]).toBe(`Cello's Claude Code hooks are already in ${file}.`)
      expect(fs.readFileSync(file, "utf8")).toBe(after)

      expect((yield* run(repo)("uninstall", "claude")).failure).toBeNull()
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({})
    }).pipe(Effect.scoped))
})
