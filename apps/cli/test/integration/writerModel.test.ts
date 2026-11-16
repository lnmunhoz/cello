// CEL-119 against a real server: an orchestrator session and the builder it launched each write on a task
// through `cello`, and every comment and history line says which model wrote it, read from that agent's own
// invented Claude Code transcript in a temp projects folder (the server reads `<dataDir>/claude/projects`,
// never ~/.claude). A `/model` switch shows on new comments only; `cello agents` shows each one's model; a
// session no hook reported a transcript for writes as before, with no model.
import * as fs from "node:fs"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import type { TaskDetail } from "@cello/contract/views"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo } from "./cli.ts"

const X = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const Y = "7330433e-0000-4000-8000-000000000000"
const BUILDER = "a13bfb89c0de1234f"

/** A reply as Claude Code writes it: the model on the message, the effort beside it. */
const reply = (model: string, effort: string) =>
  `${JSON.stringify({ type: "assistant", uuid: crypto.randomUUID(), effort, message: { model, role: "assistant", content: [{ type: "text", text: "ok" }] } })}\n`

const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port)
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })

  const folder = path.join(dataDir, "claude", "projects", "-work-cello")
  const sessionFile = path.join(folder, `${X}.jsonl`)
  const builderFile = path.join(folder, X, "subagents", `agent-${BUILDER}.jsonl`)
  fs.mkdirSync(path.dirname(builderFile), { recursive: true })
  fs.writeFileSync(sessionFile, reply("claude-opus-5-5", "high"))
  fs.writeFileSync(builderFile, reply("claude-sonnet-5-5", "medium"))

  const env = { CLAUDE_CODE_SESSION_ID: X, CLAUDE_PID: String(process.pid) }
  const x = cello({ port, env, cwd: repo })
  const hook = (event: string, input: Record<string, unknown>) =>
    cello({ port, env: {}, cwd: repo, stdin: JSON.stringify({ session_id: X, transcript_path: sessionFile, ...input }) })("hook", "claude", event)
  yield* x("task", "create", "Pancake timer")
  yield* x("task", "claim", "CEL-1")
  // The orchestrator launches the builder: the hooks report both transcripts.
  yield* hook("post-tool-use", {
    hook_event_name: "PostToolUse", tool_name: "Agent", tool_use_id: "toolu_launch",
    tool_input: { subagent_type: "cello-builder", description: "CEL-1 pancake timer", prompt: "Build CEL-1." },
    tool_response: { agentId: BUILDER, status: "async_launched" },
  })
  yield* hook("subagent-start", { hook_event_name: "SubagentStart", agent_id: BUILDER, agent_type: "cello-builder" })
  return {
    sessionFile,
    x,
    builder: (...args: string[]) => x("--agent", `cello-builder/${BUILDER}`, ...args),
    /** Another session no hook told the server about. */
    y: cello({ port, env: { CLAUDE_CODE_SESSION_ID: Y, CLAUDE_PID: String(process.pid) }, cwd: repo }),
    me: cello({ port, env: {}, cwd: repo }),
  }
})

describe("which model wrote it (CEL-119)", () => {
  it.live("names the model and effort of each comment and history line: the orchestrator's, its builder's, and a /model switch on new ones only", () =>
    Effect.gen(function* () {
      const { sessionFile, x, builder, y, me } = yield* setup
      expect((yield* x("task", "comment", "CEL-1", "Plan: a timer that flips at 90 s")).failure).toBeNull()
      expect((yield* builder("task", "comment", "CEL-1", "Built; tests pass")).failure).toBeNull()
      yield* builder("task", "stage", "CEL-1", "review")
      // The orchestrator switches model (`/model sonnet`): its next reply says so.
      fs.appendFileSync(sessionFile, reply("claude-sonnet-5-5", "low"))
      expect((yield* x("task", "comment", "CEL-1", "Reviewed")).failure).toBeNull()
      expect((yield* y("task", "comment", "CEL-1", "From a session with no transcript")).failure).toBeNull()

      const shown = (yield* me("task", "get", "CEL-1")).out
      const lines = shown.split("\n")
      const after = lines.slice(lines.indexOf("Comments (4)") + 1)
      const comments = after.slice(0, after.indexOf("")).filter((l) => !l.startsWith("    "))
      expect(comments.map((l) => l.replace(/ · id \w+$/, ""))).toEqual([
        "  Claude Code session 2fd0505c (Opus 5.5, high) · just now",
        `  cello-builder · ${BUILDER.slice(0, 8)} (Sonnet 5.5, medium; under Claude Code session 2fd0505c) · just now`,
        "  Claude Code session 2fd0505c (Sonnet 5.5, low) · just now",
        "  Claude Code session 7330433e · just now",
      ])
      expect(shown).toContain(`cello-builder · ${BUILDER.slice(0, 8)} (Sonnet 5.5, medium; under Claude Code session 2fd0505c) set the stage to Agent review`)
      // Recent activity names the model of each comment as it was written.
      const recent = (yield* me("context")).out
      expect(recent).toMatch(/CEL-1 +Claude Code session 2fd0505c \(Opus 5\.5, high\) commented/)
      expect(recent).toMatch(/CEL-1 +Claude Code session 2fd0505c \(Sonnet 5\.5, low\) commented/)
      expect(shown).toContain(`Subagents on it (1)\n  cello-builder · ${BUILDER.slice(0, 8)} (Sonnet 5.5, medium; under Claude Code session 2fd0505c): working`)

      // The JSON carries the ids as Claude Code names them, kept with each comment.
      const detail = JSON.parse((yield* me("task", "get", "CEL-1", "--json")).out) as TaskDetail
      expect(detail.comments.map((c) => [c.body, c.agentId ?? null, c.model ?? null, c.effort ?? null])).toEqual([
        ["Plan: a timer that flips at 90 s", null, "claude-opus-5-5", "high"],
        ["Built; tests pass", BUILDER, "claude-sonnet-5-5", "medium"],
        ["Reviewed", null, "claude-sonnet-5-5", "low"],
        ["From a session with no transcript", null, null, null],
      ])
    }).pipe(Effect.scoped))

  it.live("`cello agents` names the model each agent is on now", () =>
    Effect.gen(function* () {
      const { x, builder, me } = yield* setup
      yield* x("task", "comment", "CEL-1", "Started")
      yield* builder("task", "comment", "CEL-1", "On it")
      const listed = (yield* me("agents")).out
      expect(listed).toMatch(/\n  Claude Code session 2fd0505c \(Opus 5\.5, high\) +orchestrator +active now +holds CEL-1/)
      expect(listed).toMatch(/\n    cello-builder\/a13bfb89 \(Sonnet 5\.5, medium\) +active now +on CEL-1/)
    }).pipe(Effect.scoped))
})
