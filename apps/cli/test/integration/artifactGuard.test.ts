// CEL-57: in a Cello project, `cello install claude` adds a PreToolUse hook on Claude Code's Artifact
// tool. The hook, a real `cello hook claude pre-tool-use` process with no server anywhere, denies a
// publish with a reason that points to `cello doc publish`, lets every other action through silently,
// and lets everything through with CELLO_ALLOW_ARTIFACTS=1. Settings files live in temp folders with
// a temp HOME (never the real ~/.claude).
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { ARTIFACT_DENY_REASON } from "../../src/claudeHook.ts"
import { cello, hookProcess, installSetup, TEST_HOME } from "./cli.ts"

const GUARD = { matcher: "Artifact|AskUserQuestion|Edit|Write|NotebookEdit|Bash", hooks: [{ type: "command", command: "cello hook claude pre-tool-use", timeout: 10 }] }

/** Claude Code's PreToolUse input for an Artifact call. */
const artifactCall = (toolInput: Record<string, unknown>) =>
  JSON.stringify({
    session_id: "2fd0505c-417a-4167-acfe-2d66080fcae0",
    transcript_path: "/tmp/t.jsonl",
    cwd: "/tmp/app",
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: "Artifact",
    tool_input: toolInput,
    tool_use_id: "toolu_01",
  })

/** A port nothing listens on: the guard must not need the server. */
const deadPort = () => {
  const probe = Bun.serve({ port: 0, fetch: () => new Response() })
  const port = probe.port
  probe.stop(true)
  return String(port)
}

describe("cello hook claude pre-tool-use", () => {
  it.live("denies a publish on stdout, in Claude Code's PreToolUse format, with no server running; exit 0", () =>
    Effect.gen(function* () {
      const run = yield* hookProcess("pre-tool-use", { CELLO_PORT: deadPort(), HOME: TEST_HOME }, artifactCall({ file_path: "/tmp/report.html", icon: "document" }))
      expect(run.exitCode).toBe(0)
      expect(run.stderr).toBe("")
      expect(JSON.parse(run.stdout)).toEqual({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: ARTIFACT_DENY_REASON },
      })
    }))

  it.live("lets a read through silently, and everything through with CELLO_ALLOW_ARTIFACTS=1", () =>
    Effect.gen(function* () {
      const env = { CELLO_PORT: deadPort(), HOME: TEST_HOME }
      expect(yield* hookProcess("pre-tool-use", env, artifactCall({ action: "read", url: "https://claude.ai/artifact/abc" })))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" })
      expect(yield* hookProcess("pre-tool-use", { ...env, CELLO_ALLOW_ARTIFACTS: "1" }, artifactCall({ file_path: "/tmp/report.html" })))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" })
    }))

  it.live("broken input or stdin that never closes: silence and exit 0", () =>
    Effect.gen(function* () {
      expect(yield* hookProcess("pre-tool-use", { HOME: TEST_HOME }, "{not json")).toEqual({ exitCode: 0, stdout: "", stderr: "" })
      expect(yield* hookProcess("pre-tool-use", { HOME: TEST_HOME, CELLO_HOOK_DEADLINE_MS: "100" }, null)).toEqual({ exitCode: 0, stdout: "", stderr: "" })
    }))

  it.live("in process, the same: a deny for a publish with assets, nothing for another tool", () =>
    Effect.gen(function* () {
      const hook = (stdin: string) => cello({ port: 1, env: {}, cwd: "/tmp", stdin })("hook", "claude", "pre-tool-use")
      const denied = yield* hook(artifactCall({ action: "publish", url: "https://claude.ai/artifact/abc", file_paths: ["/tmp/a.png"], asset: true }))
      expect(denied.failure).toBeNull()
      expect(JSON.parse(denied.out).hookSpecificOutput.permissionDecision).toBe("deny")
      expect(yield* hook(JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } }))).toEqual({ out: "", failure: null })
    }))
})

describe("cello install claude: the artifact guard", () => {
  it.live("goes into the project's settings.local.json next to the comment hooks; again changes nothing; uninstall takes it out", () =>
    Effect.gen(function* () {
      const { repo, run } = yield* installSetup
      const file = path.join(repo, ".claude", "settings.local.json")
      expect((yield* run(repo)("install", "claude")).failure).toBeNull()
      const installed = fs.readFileSync(file, "utf8")
      expect(JSON.parse(installed).hooks.PreToolUse).toEqual([GUARD])

      // The second line is the plugin's (CEL-64).
      expect((yield* run(repo)("install", "claude")).out.split("\n")[0]).toBe(`Cello's Claude Code hooks are already in ${file}.`)
      expect(fs.readFileSync(file, "utf8")).toBe(installed)

      expect((yield* run(repo)("uninstall", "claude")).out.split("\n")[0]).toBe(`Removed Cello's Claude Code hooks, plugin and Bash(cello:*) rule from ${file}.`)
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({})
    }).pipe(Effect.scoped))

  it.live("adds itself to settings from before it existed, keeping the user's own PreToolUse hooks; uninstall gives the file back", () =>
    Effect.gen(function* () {
      const { repo, run } = yield* installSetup
      const file = path.join(repo, ".claude", "settings.local.json")
      fs.mkdirSync(path.dirname(file))
      const original = `${JSON.stringify({
        permissions: { allow: ["Bash(cello *)"] },
        hooks: {
          PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] }],
          Stop: [{ hooks: [{ type: "command", command: "cello hook claude stop", timeout: 10 }] }],
          PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "cello hook claude post-tool-use", timeout: 10 }] }],
        },
      }, null, 2)}\n`
      fs.writeFileSync(file, original)

      const installed = yield* run(repo)("install", "claude")
      expect(installed.failure).toBeNull()
      expect(installed.out).toContain(`Kept the old file as ${file}.bak.`)
      const settings = JSON.parse(fs.readFileSync(file, "utf8"))
      expect(settings.permissions).toEqual({ allow: ["Bash(cello *)"] })
      expect(settings.hooks.PreToolUse).toEqual([{ matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] }, GUARD])
      expect(settings.hooks.Stop).toHaveLength(1)

      yield* run(repo)("uninstall", "claude")
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
        permissions: { allow: ["Bash(cello *)"] },
        hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] }] },
      })
    }).pipe(Effect.scoped))
})
