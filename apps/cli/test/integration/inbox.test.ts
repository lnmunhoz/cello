// CEL-15 against a real server: a human comment (or a Send back note) on a task claimed by session X
// reaches X once, through `cello inbox` or the Claude Code hook, never twice, even to hooks running at
// the same time; `cello context` shows new ones without taking them. The hook stays silent with exit 0
// when there's nothing new, the server is down, or stdin never closes. `cello install claude` merges
// the hooks into settings files in temp folders with a temp HOME (never the real ~/.claude).
import * as fs from "node:fs"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { writeText } from "@cello/server/testing/media"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { WAIT_NUDGE } from "../../src/claudeHook.ts"
import { cello, gitRepo, hookProcess, installSetup } from "./cli.ts"

const X = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const Y = "9f2c1a7b-other-session"
const claude = (session: string) => ({ CLAUDE_CODE_SESSION_ID: session, CLAUDE_PID: String(process.pid) })

/** Project CEL linked to a git repo; session X created CEL-1 and claimed it. */
const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port)
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })
  const x = cello({ port, env: claude(X), cwd: repo })
  yield* x("task", "create", "Comments reach agents")
  yield* x("task", "claim", "CEL-1")
  return {
    port,
    repo,
    dataDir,
    human,
    x,
    y: cello({ port, env: claude(Y), cwd: repo }),
    me: cello({ port, env: { CELLO_SESSION: "me" }, cwd: repo }),
    /** The hook as Claude Code runs it: no session in the environment, the JSON on stdin. */
    hook: (event: string, input: Record<string, unknown>) => cello({ port, env: {}, cwd: repo, stdin: JSON.stringify(input) })("hook", "claude", event),
  }
})

const NEW_COMMENT = [
  "New Cello comment on a task you claimed:",
  "",
  "CEL-1  Comments reach agents",
  "  Lucas commented, just now",
  "    Please also cover the empty state: https://example.com/spec",
  "",
  "Act on it now, then answer on the card: `cello task comment CEL-1 \"…\"` (or `--body-file -` for markdown), so Lucas sees your reply there.",
].join("\n")

describe("cello inbox", () => {
  it.live("a human comment on a task claimed by session X shows up once in `cello inbox --new` for X, and not a second time", () =>
    Effect.gen(function* () {
      const { x, y, me } = yield* setup
      expect(yield* me("task", "comment", "CEL-1", "Please also cover the empty state: https://example.com/spec"))
        .toEqual({ out: "Commented on CEL-1", failure: null })

      expect(yield* y("inbox", "--new")).toEqual({ out: "", failure: null })
      expect(yield* x("inbox", "--new")).toEqual({ out: NEW_COMMENT, failure: null })
      expect(yield* x("inbox", "--new")).toEqual({ out: "", failure: null })

      // Without --new: nothing new, and what came earlier.
      expect(yield* x("inbox")).toEqual({
        out: [
          "No new comments for Claude Code session 2fd0505c.",
          "",
          "Earlier",
          "  CEL-1  Comments reach agents",
          "    Lucas commented, just now",
          "      Please also cover the empty state: https://example.com/spec",
        ].join("\n"),
        failure: null,
      })
      // The agent's own comments don't come back to it.
      yield* x("task", "comment", "CEL-1", "On it")
      expect(yield* x("inbox", "--new")).toEqual({ out: "", failure: null })
    }).pipe(Effect.scoped))

  it.live("--json prints what it handed over (now read) and what came earlier", () =>
    Effect.gen(function* () {
      const { x, me } = yield* setup
      yield* me("task", "comment", "CEL-1", "One")
      const first = yield* x("inbox", "--json")
      expect(first.failure).toBeNull()
      const inbox = JSON.parse(first.out)
      expect(inbox.session.externalId).toBe(X)
      expect(inbox.items.map((i: { kind: string; taskKey: string; comment: { body: string } }) => [i.kind, i.taskKey, i.comment.body]))
        .toEqual([["comment", "CEL-1", "One"]])
      expect(inbox.items[0].readAt).toEqual(expect.any(Number))
      expect(inbox.earlier).toEqual([])
      const second = JSON.parse((yield* x("inbox", "--json")).out)
      expect(second.items).toEqual([])
      expect(second.earlier.map((i: { comment: { body: string } }) => i.comment.body)).toEqual(["One"])
      expect(JSON.parse((yield* x("inbox", "--new", "--json")).out)).toMatchObject({ items: [], earlier: [] })
    }).pipe(Effect.scoped))

  it.live("a Send back note lands the same way, marked as sent back", () =>
    Effect.gen(function* () {
      const { x, repo, human } = yield* setup
      writeText(repo, "vitest.log", "Tests  12 passed (12)")
      expect((yield* x("task", "submit", "CEL-1", "--summary", "Done", "--step", "Run it", "--attach", "vitest.log")).failure).toBeNull()
      yield* human["review.sendBack"]({ commandId: newCommandId(), key: "CEL-1", note: "The video is missing." })

      const delivered = yield* x("inbox", "--new")
      expect(delivered.out).toContain("CEL-1  Comments reach agents\n  Lucas sent it back, just now\n    The video is missing.")
      expect(delivered.out).toContain("For a task Lucas sent back, fix what the note asks, then hand it in again with `cello task submit CEL-1`.")
      expect(yield* x("inbox", "--new")).toEqual({ out: "", failure: null })
    }).pipe(Effect.scoped))

  it.live("`cello context` shows the new comments but leaves them new, for the hook or `cello inbox` to hand over once", () =>
    Effect.gen(function* () {
      const { x, me } = yield* setup
      yield* me("task", "comment", "CEL-1", "Check the docs too")
      const shown = [
        "New comments for you (1)",
        "  CEL-1  Comments reach agents",
        "    Lucas commented, just now",
        "      Check the docs too",
        "  Answer on the card: `cello task comment CEL-1 \"…\"`. They stay new until the hook or `cello inbox` hands them over.",
      ].join("\n")
      expect((yield* x("context")).out).toContain(shown)
      // A subagent running `cello context` as the same session takes nothing.
      expect((yield* x("context")).out).toContain(shown)
      expect((yield* x("inbox", "--new")).out).toContain("Check the docs too")
      expect((yield* x("context")).out).not.toContain("New comments for you")
    }).pipe(Effect.scoped))

  it.live("the human has no inbox", () =>
    Effect.gen(function* () {
      const { me } = yield* setup
      expect(yield* me("inbox", "--new")).toEqual({ out: "", failure: null })
      expect((yield* me("inbox")).out).toBe(
        "The human has no inbox: comments reach the agent session that claimed the task. Run this from an agent session (CLAUDE_CODE_SESSION_ID or CELLO_SESSION set).",
      )
    }).pipe(Effect.scoped))
})

describe("cello hook claude", () => {
  it.live("Stop: hands the comments back as hook feedback when something is new; otherwise it only asks for a waiter (CEL-74)", () =>
    Effect.gen(function* () {
      const { hook, me } = yield* setup
      const stop = { session_id: X, cwd: "/tmp", hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "Done." }
      // Nothing new: X holds CEL-1 and nothing waits for it, so it's asked to start `cello inbox --wait` (inboxWait.test.ts).
      expect(JSON.parse((yield* hook("stop", stop)).out)).toEqual({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: WAIT_NUDGE(["CEL-1"]) } })

      yield* me("task", "comment", "CEL-1", "Please also cover the empty state: https://example.com/spec")
      const delivered = yield* hook("stop", stop)
      expect(delivered.failure).toBeNull()
      expect(JSON.parse(delivered.out)).toEqual({ hookSpecificOutput: { hookEventName: "Stop", additionalContext: NEW_COMMENT } })
      // Delivered once: the next stop goes through.
      expect(yield* hook("stop", { ...stop, stop_hook_active: true })).toEqual({ out: "", failure: null })
    }).pipe(Effect.scoped))

  it.live("Stop with stop_hook_active still hands over a comment that arrived while the agent was answering", () =>
    Effect.gen(function* () {
      const { hook, me } = yield* setup
      yield* me("task", "comment", "CEL-1", "One more thing")
      const out = JSON.parse((yield* hook("stop", { session_id: X, hook_event_name: "Stop", stop_hook_active: true })).out)
      expect(out.hookSpecificOutput.additionalContext).toContain("One more thing")
    }).pipe(Effect.scoped))

  it.live("PostToolUse: adds the comments as context; inside a subagent it stays silent and leaves them for the main conversation", () =>
    Effect.gen(function* () {
      const { hook, me } = yield* setup
      yield* me("task", "comment", "CEL-1", "Use the shared helper")
      const post = { session_id: X, hook_event_name: "PostToolUse", tool_name: "Bash", tool_input: { command: "ls" }, tool_response: {}, tool_use_id: "t1" }
      expect(yield* hook("post-tool-use", { ...post, agent_id: "a1", agent_type: "Explore" })).toEqual({ out: "", failure: null })

      const out = JSON.parse((yield* hook("post-tool-use", post)).out)
      expect(out).toEqual({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: expect.stringContaining("Use the shared helper") } })
      expect(yield* hook("post-tool-use", post)).toEqual({ out: "", failure: null })
    }).pipe(Effect.scoped))

  it.live("three hooks at once (parallel tool calls): exactly one hands the comment over", () =>
    Effect.gen(function* () {
      const { port, me } = yield* setup
      yield* me("task", "comment", "CEL-1", "Only once, please")
      const stdin = JSON.stringify({ session_id: X, hook_event_name: "PostToolUse", tool_name: "Bash" })
      const env = { CELLO_PORT: String(port) }
      const runs = yield* Effect.all([1, 2, 3].map(() => hookProcess("post-tool-use", env, stdin)), { concurrency: "unbounded" })
      expect(runs.map((r) => r.exitCode)).toEqual([0, 0, 0])
      const delivered = runs.filter((r) => r.stdout !== "")
      expect(delivered).toHaveLength(1)
      expect(delivered[0]!.stdout).toContain("Only once, please")
    }).pipe(Effect.scoped))

  it.live("falls back to CLAUDE_CODE_SESSION_ID when stdin has no session; no session at all is silence", () =>
    Effect.gen(function* () {
      const { port, repo, me } = yield* setup
      yield* me("task", "comment", "CEL-1", "From the environment")
      expect(yield* cello({ port, env: {}, cwd: repo, stdin: "" })("hook", "claude", "stop")).toEqual({ out: "", failure: null })
      const out = yield* cello({ port, env: claude(X), cwd: repo, stdin: "not json" })("hook", "claude", "stop")
      expect(JSON.parse(out.out).hookSpecificOutput.additionalContext).toContain("From the environment")
    }).pipe(Effect.scoped))

  it.live("a server that's down gives silence and exit 0, in a real process", () =>
    Effect.gen(function* () {
      // A port nothing listens on: bind one, then let it go.
      const probe = Bun.serve({ port: 0, fetch: () => new Response() })
      const port = probe.port
      probe.stop(true)
      const stdin = JSON.stringify({ session_id: X, hook_event_name: "Stop", stop_hook_active: false })
      expect(yield* hookProcess("stop", { CELLO_PORT: String(port) }, stdin)).toEqual({ exitCode: 0, stdout: "", stderr: "" })
    }))

  it.live("stdin that never closes doesn't keep it alive: it gives up at its deadline and exits 0", () =>
    Effect.gen(function* () {
      const probe = Bun.serve({ port: 0, fetch: () => new Response() })
      const port = probe.port
      probe.stop(true)
      // The deadline is 2 s; the test shortens it so it runs fast.
      expect(yield* hookProcess("stop", { CELLO_PORT: String(port), CELLO_HOOK_DEADLINE_MS: "100" }, null))
        .toEqual({ exitCode: 0, stdout: "", stderr: "" })
    }))
})

const HOOK_LINES = [
  "  Stop         cello hook claude stop",
  "  PostToolUse  cello hook claude post-tool-use",
  "  PreToolUse   cello hook claude pre-tool-use",
]
const AFTER = [
  "Your comments and Send back notes on a task an agent session claimed now reach that session: when it stops, and after each tool call.",
  "Agents here can't publish Claude artifacts: they're told to publish a Cello page instead. Start Claude Code with CELLO_ALLOW_ARTIFACTS=1 when you want one.",
  "Agents here can't edit files in the repo until their session has claimed a Cello task: they're told to create or claim one first. Start Claude Code with CELLO_ALLOW_UNTRACKED=1 to turn that off.",
  "The plugin gives new sessions /cello:orchestrate (run tasks through builder and reviewer agents), /cello:work (do one task in this thread) and the cello skill.",
  "New Claude Code sessions pick them up.",
]
/** Where install writes the plugin for a HOME without XDG_DATA_HOME (CEL-64). */
const pluginAt = (home: string) => path.join(home, ".local", "share", "cello", "claude-plugin")
const enabledIn = (file: string, home: string) => `Enabled Cello's Claude Code plugin in ${file}; its files are in ${pluginAt(home)}.`

describe("cello install claude", () => {
  it.live("writes the project's .claude/settings.local.json by default, git-ignores it, and does nothing the second time", () =>
    Effect.gen(function* () {
      const { repo, home, run } = yield* installSetup
      const file = path.join(repo, ".claude", "settings.local.json")
      expect(yield* run(path.join(repo, "src"))("install", "claude")).toEqual({
        out: [
          `Installed Cello's Claude Code hooks in ${file} (this machine only):`,
          ...HOOK_LINES,
          enabledIn(file, home),
          `Added .claude/settings.local.json to ${path.join(repo, ".gitignore")}, so it stays on this machine.`,
          ...AFTER,
        ].join("\n"),
        failure: null,
      })
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "cello hook claude stop", timeout: 10 }] }],
          PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "cello hook claude post-tool-use", timeout: 10 }] }],
          PreToolUse: [{ matcher: "Artifact|Edit|Write|NotebookEdit", hooks: [{ type: "command", command: "cello hook claude pre-tool-use", timeout: 10 }] }],
        },
        enabledPlugins: { "cello@cello": true },
        extraKnownMarketplaces: { cello: { source: { source: "directory", path: pluginAt(home) } } },
      })
      expect(fs.readFileSync(path.join(repo, ".gitignore"), "utf8")).toBe(".claude/settings.local.json\n")
      expect(Bun.spawnSync(["git", "status", "--porcelain", "--untracked-files=all"], { cwd: repo }).stdout.toString()).toBe("?? .gitignore\n")

      const before = fs.readFileSync(file, "utf8")
      expect(yield* run(repo)("install", "claude")).toEqual({
        out: [
          `Cello's Claude Code hooks are already in ${file}.`,
          `Cello's Claude Code plugin is already enabled in ${file}, and its files in ${pluginAt(home)} are current.`,
        ].join("\n"),
        failure: null,
      })
      expect(fs.readFileSync(file, "utf8")).toBe(before)
      expect(fs.readFileSync(path.join(repo, ".gitignore"), "utf8")).toBe(".claude/settings.local.json\n")
    }).pipe(Effect.scoped))

  it.live("leaves a .gitignore that already covers the file alone", () =>
    Effect.gen(function* () {
      const { repo, run } = yield* installSetup
      fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n.claude/*.local.json")
      const installed = yield* run(repo)("install", "claude")
      expect(installed.out).not.toContain("Added")
      expect(fs.readFileSync(path.join(repo, ".gitignore"), "utf8")).toBe("node_modules/\n.claude/*.local.json")
    }).pipe(Effect.scoped))

  it.live("--shared merges into .claude/settings.json, keeping its hooks, order and indentation, with the old file in .bak", () =>
    Effect.gen(function* () {
      const { repo, home, run } = yield* installSetup
      const file = path.join(repo, ".claude", "settings.json")
      const local = path.join(repo, ".claude", "settings.local.json")
      fs.mkdirSync(path.dirname(file))
      const original = `${JSON.stringify({ permissions: { allow: ["Bash(cello *)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] }, model: "opus" }, null, 4)}\n`
      fs.writeFileSync(file, original)

      expect(yield* run(repo)("install", "claude", "--shared")).toEqual({
        out: [
          `Installed Cello's Claude Code hooks in ${file} (shared: committed with the repo):`,
          ...HOOK_LINES,
          enabledIn(file, home),
          `Its marketplace is a folder on this machine, so it's declared in ${local}, which isn't committed: ` +
          "others who clone the repo get the plugin once they run `cello install claude` themselves.",
          `Added .claude/settings.local.json to ${path.join(repo, ".gitignore")}, so it stays on this machine.`,
          `Kept the old file as ${file}.bak.`,
          ...AFTER,
        ].join("\n"),
        failure: null,
      })
      const text = fs.readFileSync(file, "utf8")
      expect(Object.keys(JSON.parse(text))).toEqual(["permissions", "hooks", "model", "enabledPlugins"])
      expect(text.split("\n")[1]).toBe("    \"permissions\": {")
      expect(JSON.parse(text).hooks.Stop).toEqual([
        { hooks: [{ type: "command", command: "say done" }] },
        { hooks: [{ type: "command", command: "cello hook claude stop", timeout: 10 }] },
      ])
      // A path under this machine's home means nothing to someone else, so it isn't committed.
      expect(JSON.parse(text)).not.toHaveProperty("extraKnownMarketplaces")
      expect(JSON.parse(fs.readFileSync(local, "utf8"))).toEqual({
        extraKnownMarketplaces: { cello: { source: { source: "directory", path: pluginAt(home) } } },
      })
      expect(fs.readFileSync(`${file}.bak`, "utf8")).toBe(original)

      // Uninstalling gives back the committed file byte for byte.
      expect(yield* run(repo)("uninstall", "claude")).toEqual({
        out: [
          `Removed Cello's Claude Code plugin from ${local}.`,
          `Removed Cello's Claude Code hooks and plugin from ${file}.`,
          `The plugin's files stay in ${pluginAt(home)}, for other projects that still enable it; delete that folder when none do.`,
        ].join("\n"),
        failure: null,
      })
      expect(fs.readFileSync(file, "utf8")).toBe(original)
    }).pipe(Effect.scoped))

  it.live("from inside a linked worktree, writes the main checkout's settings", () =>
    Effect.gen(function* () {
      const { dir, repo, run } = yield* installSetup
      const git = (...args: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: repo })
      git("commit", "-q", "--allow-empty", "-m", "init")
      const worktree = path.join(dir, "app-wt")
      git("worktree", "add", "-q", worktree)
      const installed = yield* run(worktree)("install", "claude")
      expect(installed.failure).toBeNull()
      expect(fs.existsSync(path.join(repo, ".claude", "settings.local.json"))).toBe(true)
      expect(fs.existsSync(path.join(worktree, ".claude"))).toBe(false)
    }).pipe(Effect.scoped))

  it.live("--user writes ~/.claude/settings.json under HOME, without the artifact guard; it warns when cello isn't on PATH and refuses a broken file", () =>
    Effect.gen(function* () {
      const { dir, home, run } = yield* installSetup
      const file = path.join(home, ".claude", "settings.json")
      const installed = yield* run(dir, "")("install", "claude", "--user")
      expect(installed.failure).toBeNull()
      expect(installed.out.split("\n").slice(0, 3)).toEqual([`Installed Cello's Claude Code hooks in ${file} (every project):`, ...HOOK_LINES.slice(0, 2)])
      expect(installed.out).not.toContain("artifacts")
      expect(installed.out).toContain("`cello` isn't on your PATH, so Claude Code can't run the hooks. Put the cello binary on the PATH Claude Code starts with (e.g. ~/.local/bin).")
      // The guard is for Cello projects; every project on the machine isn't one.
      expect(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).hooks)).toEqual(["Stop", "PostToolUse"])

      fs.writeFileSync(file, "{ broken")
      expect(yield* run(dir)("install", "claude", "--user")).toEqual({
        out: "",
        failure: `Can't update ${file}: it isn't valid JSON. Fix it first; Cello won't overwrite it.`,
      })
      expect(fs.readFileSync(file, "utf8")).toBe("{ broken")
      expect(yield* run(dir)("install", "claude", "--user", "--shared")).toEqual({
        out: "",
        failure: "Pick one: --user (every project) or --shared (this project, committed). Without either it's this project on this machine.",
      })
    }).pipe(Effect.scoped))

  it.live("uninstall looks in all three places and takes Cello's hooks and plugin out of each, leaving the plugin's files", () =>
    Effect.gen(function* () {
      const { repo, home, run } = yield* installSetup
      yield* run(repo)("install", "claude")
      yield* run(repo)("install", "claude", "--shared")
      yield* run(repo)("install", "claude", "--user")
      const local = path.join(repo, ".claude", "settings.local.json")
      const shared = path.join(repo, ".claude", "settings.json")
      const user = path.join(home, ".claude", "settings.json")
      expect(yield* run(repo)("uninstall", "claude")).toEqual({
        out: [
          `Removed Cello's Claude Code hooks and plugin from ${local}.`,
          `Removed Cello's Claude Code hooks and plugin from ${shared}.`,
          `Removed Cello's Claude Code hooks and plugin from ${user}.`,
          `The plugin's files stay in ${pluginAt(home)}, for other projects that still enable it; delete that folder when none do.`,
        ].join("\n"),
        failure: null,
      })
      for (const file of [local, shared, user]) expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({})
      expect(fs.existsSync(path.join(pluginAt(home), "cello", "commands", "orchestrate.md"))).toBe(true)
      expect(yield* run(repo)("uninstall", "claude")).toEqual({ out: `No Cello hooks or plugin in ${local}, ${shared} or ${user}.`, failure: null })
    }).pipe(Effect.scoped))
})
