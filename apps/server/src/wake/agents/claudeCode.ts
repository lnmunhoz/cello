// The Claude Code driver (CEL-92): continues a Claude Code session headless with Lucas's own installed
// `claude`, the same login as his terminal:
//
//   claude -p --resume <session id> --permission-mode <mode> --output-format stream-json --verbose \
//     --max-turns 40 "<prompt>"
//
// in the session's repo folder. `-p` loads the repo's CLAUDE.md, .claude/settings.json hooks, .mcp.json
// and skills like an interactive session, Cello's hooks included, so the run checks in and comments as
// the same session. A resumed `-p` run doesn't keep the original session's permission mode, so the
// mode is always passed: the one Cello's hooks recorded (Lucas's decision), never bypassPermissions.
//
// The process gets its own process group: Stop (closing the scope) and the end of a turn send SIGTERM
// to the whole group, so nothing it started (a tool, a background shell) outlives it; whatever ignores
// SIGTERM gets SIGKILL after KILL_GRACE_MS. A turn ends once all its output is closed.
import { spawn } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as readline from "node:readline"
import type { CelloMode } from "@cello/contract/entities"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Exit from "effect/Exit"
import { type AgentDriver, type AgentEvent, type AgentMode, AgentStartFailed, type TurnEnded } from "./AgentDriver.ts"

/** The most agentic turns a woken run may take: it's unattended, so it stops well before it could wander off. */
export const MAX_TURNS = 40

/**
 * How long the processes of a run get to exit after SIGTERM before they're killed, and how long its
 * output may stay open after the CLI itself exited before the turn ends anyway (a process that left the
 * group, with setsid, can hold it open forever).
 */
export const KILL_GRACE_MS = 5_000

/** Claude Code's permission modes in Cello's words. None recorded runs as `default`; any other is refused. */
const MODES: ReadonlyMap<string, CelloMode> = new Map([
  ["default", "ask"],
  ["dontAsk", "ask"],
  ["acceptEdits", "edits"],
  ["auto", "auto"],
  ["plan", "plan"],
  ["bypassPermissions", "bypass"],
])

/** A session id that may reach the command line and a file name: letters, digits, `.`, `_` and `-`, not first. */
export const isSessionId = (id: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)

/** Claude Code's folder name under `projects/` for a working folder: every character but letters and digits is `-`. */
export const projectFolderName = (folder: string): string => folder.replace(/[^A-Za-z0-9]/g, "-")

/** The arguments of a woken run, after `claude`. */
export const claudeArgs = (input: { readonly nativeId: string; readonly mode: string; readonly prompt: string }): string[] => [
  "-p",
  "--resume",
  input.nativeId,
  "--permission-mode",
  input.mode,
  "--output-format",
  "stream-json",
  "--verbose",
  "--max-turns",
  String(MAX_TURNS),
  // Nothing after this is a flag, whatever the prompt starts with.
  "--",
  input.prompt,
]

/** Claude Code's folder: CLAUDE_CONFIG_DIR, else ~/.claude. */
const configDir = (env: Readonly<Record<string, string | undefined>>) => env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), ".claude")

/** SIGTERM or SIGKILL to a whole process group; one that's already gone is fine. */
const signalGroup = (pid: number, signal: NodeJS.Signals) => {
  try {
    process.kill(-pid, signal)
  } catch {
    // Already gone.
  }
}

/** Whether any process of the group is left. */
const groupAlive = (pid: number) => {
  try {
    process.kill(-pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM"
  }
}

/** The normalized events a stream-json line stands for (the ones phase ① uses; the rest are in the log). */
const eventsOf = (value: unknown): AgentEvent[] => {
  if (typeof value !== "object" || value === null) return []
  const line = value as { type?: unknown; message?: { content?: unknown } }
  if (line.type !== "assistant" && line.type !== "user") return []
  const content = Array.isArray(line.message?.content) ? line.message.content : []
  return content.flatMap((part: { type?: unknown; text?: unknown; name?: unknown }): AgentEvent[] => {
    if (part.type === "text" && typeof part.text === "string") return [{ type: "message", text: part.text }]
    if (part.type === "tool_use" && typeof part.name === "string") return [{ type: "tool.started", name: part.name }]
    if (part.type === "tool_result") return [{ type: "tool.finished", name: "" }]
    return []
  })
}

export interface ClaudeCodeOptions {
  /** The command to run; `claude` on the environment's PATH by default. */
  readonly binary?: string
  /** KILL_GRACE_MS; tests shorten it. */
  readonly killGraceMs?: number
}

export const claudeCode = (options: ClaudeCodeOptions = {}): AgentDriver => {
  const binary = options.binary ?? "claude"
  const grace = options.killGraceMs ?? KILL_GRACE_MS
  const which = (env: Readonly<Record<string, string | undefined>>) => Bun.which(binary, { PATH: env.PATH ?? "" })

  const modeFor = (recorded: string | null): AgentMode | null => {
    if (recorded === null) return { native: "default", cello: "ask" }
    const cello = MODES.get(recorded)
    return cello === undefined ? null : { native: recorded, cello }
  }

  return {
    kind: "claude-code",
    name: "Claude Code",
    capabilities: { resume: true, streamingInput: false, permissionRequests: false, modes: ["ask", "edits", "auto", "plan"] },
    installed: (env) => Effect.sync(() => which(env) !== null),
    // `claude --resume` finds a conversation in the folder it was started in: projects/<that folder's
    // name>/<id>.jsonl. The session's recorded folder may be below it (its last command ran in a
    // subfolder), so the nearest folder up that holds it is where the run starts.
    conversationFolder: ({ nativeId, cwd, env }) =>
      Effect.sync(() => {
        if (!isSessionId(nativeId) || !path.isAbsolute(cwd)) return null
        const projects = path.join(configDir(env), "projects")
        for (let folder = path.resolve(cwd); ; folder = path.dirname(folder)) {
          if (fs.existsSync(path.join(projects, projectFolderName(folder), `${nativeId}.jsonl`))) return folder
          if (folder === path.dirname(folder)) return null
        }
      }),
    modeFor,
    open: (input) =>
      Effect.gen(function* () {
        /** The running turn's process, while there is one; the scope's finalizer stops it. */
        let running: { readonly pid: number; readonly ended: Deferred.Deferred<TurnEnded>; stop: () => void } | null = null
        yield* Effect.addFinalizer(() =>
          Effect.suspend(() => {
            const turn = running
            if (turn === null) return Effect.void
            turn.stop()
            return Effect.asVoid(Deferred.await(turn.ended))
          }))

        const resume = (prompt: string) =>
          Effect.gen(function* () {
            if (!isSessionId(input.nativeId)) return yield* new AgentStartFailed({ message: `${JSON.stringify(input.nativeId)} isn't a Claude Code session id` })
            const command = which(input.env)
            if (command === null) return yield* new AgentStartFailed({ message: `\`${binary}\` isn't on the PATH of Cello's server` })
            const ended = yield* Deferred.make<TurnEnded>()
            const child = yield* Effect.try({
              try: () =>
                spawn(command, claudeArgs({ nativeId: input.nativeId, mode: input.mode, prompt }), {
                  cwd: input.cwd,
                  env: input.env as NodeJS.ProcessEnv,
                  detached: true,
                  stdio: ["ignore", "pipe", "pipe"],
                }),
              catch: (error) => new AgentStartFailed({ message: `\`${binary}\` couldn't start: ${String(error)}` }),
            })
            const pid = child.pid
            if (pid === undefined) {
              return yield* Effect.callback<never, AgentStartFailed>((resume) => {
                child.once("error", (error) => resume(Effect.fail(new AgentStartFailed({ message: `\`${binary}\` couldn't start: ${error.message}` }))))
              })
            }
            input.onEvent({ type: "run.started", pid })

            let stopping = false
            let result: string | null = null
            let done = false
            const timers: Array<ReturnType<typeof setTimeout>> = []
            const later = (ms: number, f: () => void) => {
              const timer = setTimeout(f, ms)
              timer.unref?.()
              timers.push(timer)
            }
            /** SIGTERM to the group now, SIGKILL to whatever is left of it after the grace. */
            const terminate = () => {
              signalGroup(pid, "SIGTERM")
              later(grace, () => {
                if (!done && groupAlive(pid)) signalGroup(pid, "SIGKILL")
              })
            }
            const lines = (stream: "stdout" | "stderr", from: NodeJS.ReadableStream) =>
              readline.createInterface({ input: from, crlfDelay: Infinity }).on("line", (line) => {
                input.onOutput({ stream, line })
                if (stream !== "stdout") return
                let value: unknown
                try {
                  value = JSON.parse(line)
                } catch {
                  return
                }
                const parsed = value as { type?: unknown; subtype?: unknown; is_error?: unknown }
                if (parsed?.type === "result" && parsed.is_error === true) result = typeof parsed.subtype === "string" ? parsed.subtype : "an error"
                for (const event of eventsOf(value)) input.onEvent(event)
              })
            lines("stdout", child.stdout!)
            lines("stderr", child.stderr!)
            /** The turn is over, once: its output closed, or the grace after the CLI exited ran out. */
            const finish = (code: number | null, signal: NodeJS.Signals | null) => {
              if (done) return
              done = true
              for (const timer of timers) clearTimeout(timer)
              running = null
              const turn: TurnEnded = stopping
                ? { outcome: "interrupted", exitCode: code, error: null }
                : code === 0
                ? { outcome: "completed", exitCode: 0, error: null }
                : {
                  outcome: "failed",
                  exitCode: code,
                  error: result !== null
                    ? `claude ended with ${result} (exit ${code ?? signal})`
                    : `claude exited with ${code === null ? `signal ${signal}` : `code ${code}`}`,
                }
              input.onEvent({ type: "turn.ended", ...turn })
              Deferred.doneUnsafe(ended, Exit.succeed(turn))
            }
            // The leader exited: whatever it left running in its group goes too. A process that left the
            // group may still hold the output open; after the grace the turn ends without it.
            child.once("exit", (code, signal) => {
              terminate()
              later(grace, () => {
                child.stdout?.destroy()
                child.stderr?.destroy()
                finish(code, signal)
              })
            })
            // Every holder of its output closed it: the turn is over.
            child.once("close", (code, signal) => finish(code, signal))
            running = {
              pid,
              ended,
              stop: () => {
                stopping = true
                terminate()
              },
            }
            return { pid, ended: Deferred.await(ended) }
          })

        return { resume }
      }),
  }
}
