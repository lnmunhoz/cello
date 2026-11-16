// CEL-124: in a Cello project, a question for the human goes on the card (`cello task ask`), never in
// Claude's own AskUserQuestion dialog, which blocked a session for 40 minutes. `cello install claude`
// puts AskUserQuestion in the project's PreToolUse matcher; the hook, a real `cello hook claude
// pre-tool-use` process with no server anywhere, denies every call with a reason pointing to the card,
// and lets it through with CELLO_ALLOW_ASK_USER=1. Settings files live in temp folders with a temp
// HOME (never the real ~/.claude).
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { ASK_USER_DENY_REASON } from "../../src/claudeHook.ts"
import { cello, hookProcess, installSetup, TEST_HOME } from "./cli.ts"

const GUARD = { matcher: "Artifact|AskUserQuestion|Edit|Write|NotebookEdit", hooks: [{ type: "command", command: "cello hook claude pre-tool-use", timeout: 10 }] }

/** Claude Code's PreToolUse input for an AskUserQuestion call. */
const askCall = () =>
  JSON.stringify({
    session_id: "2fd0505c-417a-4167-acfe-2d66080fcae0",
    transcript_path: "/tmp/t.jsonl",
    cwd: "/tmp/app",
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: "AskUserQuestion",
    tool_input: { questions: [{ question: "Merge CEL-109?", header: "Merge", multiSelect: false, options: [{ label: "Merge it" }, { label: "Wait" }] }] },
    tool_use_id: "toolu_01",
  })

/** A port nothing listens on: the guard must not need the server. */
const deadPort = () => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port
  probe.stop(true)
  return String(port)
}

describe("cello hook claude pre-tool-use: AskUserQuestion", () => {
  it.live("denies it on stdout, in Claude Code's PreToolUse format, with no server running; exit 0", () =>
    Effect.gen(function* () {
      const run = yield* hookProcess("pre-tool-use", { CELLO_PORT: deadPort(), HOME: TEST_HOME }, askCall())
      expect(run.exitCode).toBe(0)
      expect(run.stderr).toBe("")
      expect(JSON.parse(run.stdout)).toEqual({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: ASK_USER_DENY_REASON },
      })
    }))

  it.live("lets it through silently with CELLO_ALLOW_ASK_USER=1", () =>
    Effect.gen(function* () {
      expect(yield* hookProcess("pre-tool-use", { CELLO_PORT: deadPort(), HOME: TEST_HOME, CELLO_ALLOW_ASK_USER: "1" }, askCall()))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" })
    }))

  it.live("in process, the same deny", () =>
    Effect.gen(function* () {
      const denied = yield* cello({ port: 1, env: {}, cwd: "/tmp", stdin: askCall() })("hook", "claude", "pre-tool-use")
      expect(denied.failure).toBeNull()
      expect(JSON.parse(denied.out).hookSpecificOutput).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: ASK_USER_DENY_REASON })
    }))
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
      expect(installed.out).toContain(
        "Agents here can't ask you questions in Claude's own window: they're told to ask on the card, where the task waits in Needs input. " +
          "Start Claude Code with CELLO_ALLOW_ASK_USER=1 when you want questions in the terminal.",
      )
      expect(JSON.parse(fs.readFileSync(file, "utf8")).hooks.PreToolUse).toEqual([GUARD])

      const after = fs.readFileSync(file, "utf8")
      // The second line is the plugin's (CEL-64).
      expect((yield* run(repo)("install", "claude")).out.split("\n")[0]).toBe(`Cello's Claude Code hooks are already in ${file}.`)
      expect(fs.readFileSync(file, "utf8")).toBe(after)

      expect((yield* run(repo)("uninstall", "claude")).failure).toBeNull()
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({})
    }).pipe(Effect.scoped))
})
