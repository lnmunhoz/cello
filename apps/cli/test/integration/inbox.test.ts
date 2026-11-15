// CEL-15 against a real server: a human comment (or a Send back note) on a task claimed by session X
// reaches X once, through `cello inbox`, `cello context` or the Claude Code hook, and never twice.
// The hook stays silent with exit 0 when there's nothing new or the server is down. `cello install
// claude` merges the hooks into a settings file in a temp folder (never the real ~/.claude).
import * as fs from "node:fs"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { writeText } from "@cello/server/testing/media"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo } from "./cli.ts"

const X = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const Y = "9f2c1a7b-other-session"
const claude = (session: string) => ({ CLAUDE_CODE_SESSION_ID: session, CLAUDE_PID: String(process.pid) })
const ROOT = path.resolve(import.meta.dirname, "../../../..")

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

  it.live("--json prints the inbox as it was before reading, and marks it read", () =>
    Effect.gen(function* () {
      const { x, me } = yield* setup
      yield* me("task", "comment", "CEL-1", "One")
      const first = yield* x("inbox", "--new", "--json")
      expect(first.failure).toBeNull()
      const inbox = JSON.parse(first.out)
      expect(inbox.unread).toBe(1)
      expect(inbox.session.externalId).toBe(X)
      expect(inbox.items.map((i: { kind: string; taskKey: string; comment: { body: string }; readAt: null }) => [i.kind, i.taskKey, i.comment.body, i.readAt]))
        .toEqual([["comment", "CEL-1", "One", null]])
      expect(JSON.parse((yield* x("inbox", "--new", "--json")).out)).toMatchObject({ unread: 0, items: [] })
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

  it.live("`cello context` shows the new comments and counts them as read", () =>
    Effect.gen(function* () {
      const { x, me } = yield* setup
      yield* me("task", "comment", "CEL-1", "Check the docs too")
      const context = (yield* x("context")).out
      expect(context).toContain([
        "New comments for you (1)",
        "  CEL-1  Comments reach agents",
        "    Lucas commented, just now",
        "      Check the docs too",
        "  Answer on the card: `cello task comment CEL-1 \"…\"`.",
      ].join("\n"))
      expect((yield* x("context")).out).not.toContain("New comments for you")
      expect(yield* x("inbox", "--new")).toEqual({ out: "", failure: null })
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
  it.live("Stop: blocks with the comments as the reason when something is new, and prints nothing otherwise", () =>
    Effect.gen(function* () {
      const { hook, me } = yield* setup
      const stop = { session_id: X, cwd: "/tmp", hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: "Done." }
      expect(yield* hook("stop", stop)).toEqual({ out: "", failure: null })

      yield* me("task", "comment", "CEL-1", "Please also cover the empty state: https://example.com/spec")
      const blocked = yield* hook("stop", stop)
      expect(blocked.failure).toBeNull()
      expect(JSON.parse(blocked.out)).toEqual({ decision: "block", reason: NEW_COMMENT })
      // Delivered once: the next stop goes through.
      expect(yield* hook("stop", { ...stop, stop_hook_active: true })).toEqual({ out: "", failure: null })
    }).pipe(Effect.scoped))

  it.live("Stop with stop_hook_active still hands over a comment that arrived while the agent was answering", () =>
    Effect.gen(function* () {
      const { hook, me } = yield* setup
      yield* me("task", "comment", "CEL-1", "One more thing")
      const out = JSON.parse((yield* hook("stop", { session_id: X, hook_event_name: "Stop", stop_hook_active: true })).out)
      expect(out.decision).toBe("block")
      expect(out.reason).toContain("One more thing")
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

  it.live("falls back to CLAUDE_CODE_SESSION_ID when stdin has no session; no session at all is silence", () =>
    Effect.gen(function* () {
      const { port, repo, me } = yield* setup
      yield* me("task", "comment", "CEL-1", "From the environment")
      expect(yield* cello({ port, env: {}, cwd: repo, stdin: "" })("hook", "claude", "stop")).toEqual({ out: "", failure: null })
      const out = yield* cello({ port, env: claude(X), cwd: repo, stdin: "not json" })("hook", "claude", "stop")
      expect(JSON.parse(out.out).reason).toContain("From the environment")
    }).pipe(Effect.scoped))

  it.live("a server that's down gives silence and exit 0, in a real process", () =>
    Effect.sync(() => {
      // A port nothing listens on: bind one, then let it go.
      const probe = Bun.serve({ port: 0, fetch: () => new Response() })
      const port = probe.port
      probe.stop(true)
      const result = Bun.spawnSync(["bun", path.join(ROOT, "apps/cli/src/bin.ts"), "hook", "claude", "stop"], {
        env: { PATH: process.env.PATH, CELLO_PORT: String(port) },
        stdin: Buffer.from(JSON.stringify({ session_id: X, hook_event_name: "Stop", stop_hook_active: false })),
        stdout: "pipe",
        stderr: "pipe",
      })
      expect({ exitCode: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() })
        .toEqual({ exitCode: 0, stdout: "", stderr: "" })
    }))
})

describe("cello install claude", () => {
  it.live("merges Cello's hooks into the project's .claude/settings.json, keeps what's there, and does nothing the second time", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const repo = gitRepo(dir, "app")
      const file = path.join(repo, ".claude", "settings.json")
      fs.mkdirSync(path.dirname(file))
      fs.writeFileSync(file, JSON.stringify({ permissions: { allow: ["Bash(cello *)"] }, hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] } }))
      const bin = path.join(dir, "bin")
      fs.mkdirSync(bin)
      fs.writeFileSync(path.join(bin, "cello"), "#!/bin/sh\n", { mode: 0o755 })
      const run = cello({ port: 1, env: { HOME: path.join(dir, "home"), PATH: bin }, cwd: path.join(repo, "src") })

      expect(yield* run("install", "claude")).toEqual({
        out: [
          `Installed Cello's Claude Code hooks in ${file}:`,
          "  Stop         cello hook claude stop",
          "  PostToolUse  cello hook claude post-tool-use",
          "Your comments and Send back notes on a task an agent session claimed now reach that session: when it stops, and after each tool call.",
          "New Claude Code sessions pick them up.",
        ].join("\n"),
        failure: null,
      })
      const settings = JSON.parse(fs.readFileSync(file, "utf8"))
      expect(settings.permissions).toEqual({ allow: ["Bash(cello *)"] })
      expect(settings.hooks).toEqual({
        Stop: [
          { hooks: [{ type: "command", command: "say done" }] },
          { hooks: [{ type: "command", command: "cello hook claude stop", timeout: 10 }] },
        ],
        PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "cello hook claude post-tool-use", timeout: 10 }] }],
      })

      const before = fs.readFileSync(file, "utf8")
      expect(yield* run("install", "claude")).toEqual({ out: `Cello's Claude Code hooks are already in ${file}.`, failure: null })
      expect(fs.readFileSync(file, "utf8")).toBe(before)

      expect(yield* run("uninstall", "claude")).toEqual({ out: `Removed Cello's Claude Code hooks from ${file}.`, failure: null })
      expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({
        permissions: { allow: ["Bash(cello *)"] },
        hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] },
      })
      expect(yield* run("uninstall", "claude")).toEqual({ out: `No Cello hooks in ${file}.`, failure: null })
    }).pipe(Effect.scoped))

  it.live("--user writes ~/.claude/settings.json under HOME, warns when cello isn't on PATH, and refuses a broken file", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const home = path.join(dir, "home")
      const run = cello({ port: 1, env: { HOME: home, PATH: "" }, cwd: dir })
      const installed = yield* run("install", "claude", "--user")
      const file = path.join(home, ".claude", "settings.json")
      expect(installed.failure).toBeNull()
      expect(installed.out.split("\n")[0]).toBe(`Installed Cello's Claude Code hooks in ${file}:`)
      expect(installed.out).toContain("`cello` isn't on your PATH, so Claude Code can't run the hooks. Put the cello binary on the PATH Claude Code starts with (e.g. ~/.local/bin).")
      expect(Object.keys(JSON.parse(fs.readFileSync(file, "utf8")).hooks)).toEqual(["Stop", "PostToolUse"])

      fs.writeFileSync(file, "{ broken")
      expect(yield* run("install", "claude", "--user")).toEqual({
        out: "",
        failure: `Can't update ${file}: it isn't valid JSON. Fix it first; Cello won't overwrite it.`,
      })
      expect(fs.readFileSync(file, "utf8")).toBe("{ broken")
    }).pipe(Effect.scoped))
})
