// CEL-106 over a real server: a hook's call reports the session's transcript and current step and a
// subagent's transcript (the headers and `agent.report` the CLI's hooks send), and the human's
// `agent.log` streams the steps parsed from those files, then follows lines appended to them through the
// server's real file watcher. Each wait is for the next update the stream sends, never a timer.
import * as fs from "node:fs"
import * as path from "node:path"
import type { LogUpdate } from "@cello/contract/agentLog"
import { IDENTITY_HEADERS } from "@cello/contract/rpcs"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Queue from "effect/Queue"
import * as Stream from "effect/Stream"
import { connect, startServer, tempDataDir } from "./harness.ts"

const SESSION = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const line = (value: object) => `${JSON.stringify(value)}\n`
const said = (uuid: string, text: string) =>
  line({ type: "assistant", uuid, timestamp: "2026-11-16T09:00:00.000Z", message: { id: uuid, content: [{ type: "text", text }] } })
const call = (uuid: string, id: string, command: string) =>
  line({ type: "assistant", uuid, timestamp: "2026-11-16T09:00:01.000Z", message: { id: uuid, content: [{ type: "tool_use", id, name: "Bash", input: { command } }] } })
const result = (uuid: string, id: string, content: string, isError = false) =>
  line({ type: "user", uuid, timestamp: "2026-11-16T09:00:04.000Z", message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] } })

describe("an agent's live log over a real server", () => {
  it.live("the hook reports the transcripts; agent.log streams their steps and follows what's appended", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      const folder = path.join(dataDir, "claude", "projects", "-work-pancakes")
      const sessionFile = path.join(folder, `${SESSION}.jsonl`)
      const agentFile = path.join(folder, SESSION, "subagents", "agent-a13bfb89.jsonl")
      fs.mkdirSync(folder, { recursive: true })
      fs.writeFileSync(sessionFile, said("m1", "Launching a builder for CLO-7."))
      const { port } = yield* startServer(dataDir)

      // The PostToolUse hook in the main conversation: its call carries the transcript and the step.
      const identity = { [IDENTITY_HEADERS.session]: SESSION, [IDENTITY_HEADERS.client]: "Claude Code", [IDENTITY_HEADERS.cwd]: "/work/pancakes" }
      const hook = yield* connect(port, { ...identity, [IDENTITY_HEADERS.transcript]: sessionFile, [IDENTITY_HEADERS.step]: "Agent · cello-builder: CLO-7" })
      yield* hook["whoami"]({ project: {} })
      // SubagentStart: the subagent's own transcript, not written yet.
      const agent = yield* hook["agent.report"]({ agentId: "a13bfb89", agentType: "cello-builder", state: "started", transcriptPath: agentFile })
      expect(agent).toMatchObject({ hasLog: true })
      const sessionId = agent!.sessionId

      const human = yield* connect(port)
      const follow = (source: { readonly agentId?: string }) =>
        Effect.gen(function* () {
          const updates = yield* Queue.unbounded<LogUpdate>()
          yield* human["agent.log"]({ sessionId, ...source }).pipe(Stream.runForEach((u) => Queue.offer(updates, u)), Effect.forkScoped)
          return Queue.take(updates)
        })

      // The session's log: what's there, then a tool call and its result as they're written.
      const sessionLog = yield* follow({})
      expect(yield* sessionLog).toMatchObject({ _tag: "steps", reset: true, steps: [{ kind: "message", text: "Launching a builder for CLO-7." }] })
      fs.appendFileSync(sessionFile, call("m2", "toolu_1", "bun run test"))
      expect(yield* sessionLog).toMatchObject({ _tag: "steps", reset: false, steps: [{ id: "toolu_1", text: "Bash · bun run test", tool: { status: "running" } }] })
      fs.appendFileSync(sessionFile, result("u1", "toolu_1", "1 failed", true))
      expect(yield* sessionLog).toMatchObject({ _tag: "steps", steps: [{ id: "toolu_1", tool: { status: "error", durationMs: 3000, output: "1 failed" } }] })

      // The subagent's log: not on disk yet, then there once Claude Code writes it.
      const agentLog = yield* follow({ agentId: "a13bfb89" })
      expect(yield* agentLog).toEqual({ _tag: "unavailable", reason: "missing" })
      fs.mkdirSync(path.dirname(agentFile), { recursive: true })
      fs.writeFileSync(agentFile, said("b1", "Reading AGENTS.md first."))
      expect(yield* agentLog).toMatchObject({ _tag: "steps", reset: true, steps: [{ text: "Reading AGENTS.md first." }] })
    }).pipe(Effect.scoped))
})
