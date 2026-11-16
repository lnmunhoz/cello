// CEL-92 against a real server, with a stub `claude` on the server's PATH that records its arguments,
// environment and folder, then does what a woken session does: `cello inbox` and `cello task comment`.
// Session X claimed CEL-1 (its permission mode reported by the hook) and its process is gone; Lucas
// comments; the server runs the stub once, in the repo folder, in X's mode, with CELLO_WOKEN=1; the
// stub takes the comment and answers on the card as X. `cello sessions runs` lists the run and its log,
// and `cello sessions wake` refuses with the reason once waking is off. The real `claude` never runs.
import * as fs from "node:fs"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import type { CelloEvent } from "@cello/contract/events"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { claudeArgs, projectFolderName } from "@cello/server/wake/agents/claudeCode"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo } from "./cli.ts"

const X = "c14ca1fa-6f0e-4c1b-9d55-5b8c6c1e2a10"
const BIN = path.resolve(import.meta.dirname, "../../src/bin.ts")

/** What a woken session does, as a shell script standing in for `claude`. */
const STUB = `#!/bin/sh
rec="$STUB_RECORD"
printf '%s\\n' "cwd=$(pwd)" "woken=$CELLO_WOKEN" >> "$rec"
for a in "$@"; do printf 'arg=%s\\n' "$a" >> "$rec"; done
session=""; prev=""
for a in "$@"; do [ "$prev" = "--resume" ] && session="$a"; prev="$a"; done
export CLAUDE_CODE_SESSION_ID="$session"
echo '{"type":"system","subtype":"init"}'
bun "$CELLO_BIN" inbox --new >> "$rec" 2>&1
bun "$CELLO_BIN" task comment CEL-1 "Done: switched the icon" >> "$rec" 2>&1
echo '{"type":"result","subtype":"success","is_error":false}'
`

/** A pid that has exited: a process that ran and ended. */
const deadPid = Effect.promise(async () => {
  const proc = Bun.spawn(["true"])
  await proc.exited
  return proc.pid
})

const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const bin = path.join(dataDir, "bin")
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, "claude"), STUB, { mode: 0o755 })
  const claudeDir = path.join(dataDir, "claude")
  const record = path.join(dataDir, "stub.log")
  const tmp = path.join(dataDir, "tmp")
  fs.mkdirSync(tmp)
  const { port } = yield* startServer(dataDir, {
    wake: {
      env: { PATH: `${bin}:${process.env.PATH}`, CLAUDE_CONFIG_DIR: claudeDir, STUB_RECORD: record, CELLO_BIN: BIN, TMPDIR: tmp },
      batch: 0,
      quiet: 0,
    },
  })
  const repo = gitRepo(dataDir, "app")
  // X's conversation, where Claude Code keeps it for the repo (a temp CLAUDE_CONFIG_DIR, never the real ~/.claude).
  fs.mkdirSync(path.join(claudeDir, "projects", projectFolderName(repo)), { recursive: true })
  fs.writeFileSync(path.join(claudeDir, "projects", projectFolderName(repo), `${X}.jsonl`), "{}\n")
  const human = yield* connect(port)
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "App", key: "CEL", repoPath: repo })
  const pid = String(yield* deadPid)
  const x = cello({ port, env: { CLAUDE_CODE_SESSION_ID: X, CLAUDE_PID: pid, TMPDIR: tmp }, cwd: repo })
  yield* x("task", "create", "Use the other icon")
  yield* x("task", "claim", "CEL-1")
  // X's hook reports its permission mode, as Claude Code's hooks do on every event.
  const hook = yield* cello({ port, env: { CLAUDE_PID: pid, TMPDIR: tmp }, cwd: repo, stdin: JSON.stringify({ session_id: X, cwd: repo, permission_mode: "acceptEdits", hook_event_name: "PostToolUse" }) })(
    "hook",
    "claude",
    "post-tool-use",
  )
  expect(hook.failure).toBeNull()
  const me = cello({ port, env: { CELLO_SESSION: "me", TMPDIR: tmp }, cwd: repo })
  return { port, repo, human, workspaceId, record, dataDir, me, x }
})

describe("waking a session (CEL-92)", () => {
  it.live("Lucas's comment on a task whose session is gone runs the session's CLI once, which takes the comment and answers on the card", () =>
    Effect.gen(function* () {
      const { human, workspaceId, record, repo, me, dataDir } = yield* setup
      yield* human["wake.setSettings"]({ commandId: newCommandId(), project: { key: "CEL" }, enabled: true })
      const scope = { workspaceId }
      const from = (yield* human["snapshot.get"]({ scope })).seq
      const ended = yield* Effect.forkChild(human["events.subscribe"]({ scope, afterSeq: from }).pipe(
        Stream.filter((e: CelloEvent) => e.type === "session.run_ended"),
        Stream.runHead,
      ))
      expect((yield* me("task", "comment", "CEL-1", "Please use the other icon")).failure).toBeNull()
      const event = yield* Fiber.join(ended)
      expect(event._tag === "Some" && event.value).toMatchObject({ type: "session.run_ended", run: { why: "comment", mode: "acceptEdits", celloMode: "edits", outcome: "completed", exitCode: 0 } })

      const lines = fs.readFileSync(record, "utf8").split("\n")
      expect(lines.filter((l) => l.startsWith("arg=")).map((l) => l.slice(4))).toEqual(
        claudeArgs({
          nativeId: X,
          mode: "acceptEdits",
          prompt: "Lucas acted on CEL-1, which you claimed: run `cello inbox` and act on it, then answer on the card. Cello woke this session because its process had ended.",
        }),
      )
      expect(lines).toContain(`cwd=${repo}`)
      expect(lines).toContain("woken=1")
      // The stub took Lucas's comment through `cello inbox`, like a session.
      expect(lines.join("\n")).toContain("Please use the other icon")

      // Its answer is on the card, from X.
      const card = yield* me("task", "get", "CEL-1")
      expect(card.out).toContain("Done: switched the icon")
      expect(card.out).toContain("Cello woke Claude Code session c14ca1fa (a comment, mode acceptEdits)")
      expect(card.out).toMatch(/Claude Code session c14ca1fa's woken run completed in \d+ s/)

      const runs = yield* me("sessions", "runs", "c14ca1fa")
      expect(runs.out).toMatch(/^Woken runs of session c14ca1fa, newest first:\n {2}\S+ \S+ {2}a comment {2}acceptEdits {2}completed in \d+ s\n {4}(\S+)$/)
      const log = runs.out.split("\n")[2]!.trim()
      expect(log.startsWith(path.join(dataDir, "runs", X))).toBe(true)
      expect(fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).type)).toEqual([
        "cello.run",
        "system",
        "result",
        "cello.ended",
      ])
    }).pipe(Effect.scoped), { timeout: 30_000 })

  it.live("`cello sessions wake` wakes it now, and refuses with the reason when a check fails", () =>
    Effect.gen(function* () {
      const { human, me, record } = yield* setup
      const off = yield* me("sessions", "wake", "CEL-1")
      expect(off.failure).toBe("Cello didn't wake session c14ca1fa: waking is off for this project. The card says the same.")

      yield* human["wake.setSettings"]({ commandId: newCommandId(), project: { key: "CEL" }, enabled: true })
      const woke = yield* me("sessions", "wake", "c14ca1fa")
      expect(woke.failure).toBeNull()
      expect(woke.out).toMatch(/^Woke session c14ca1fa \(mode acceptEdits\)\./)
      const runs = yield* human["session.runs"]({ session: X })
      expect(runs.runs).toHaveLength(1)
      expect(runs.runs[0]!.run).toMatchObject({ why: "manual" })
      // The manual prompt asks it to check the card.
      yield* Effect.promise(() => waitForFile(record, "cello inbox` and check the card"))
    }).pipe(Effect.scoped), { timeout: 30_000 })
})

/** Resolves once `file` contains `text`, watching it (no polling). */
const waitForFile = (file: string, text: string) =>
  new Promise<void>((resolve) => {
    const check = () => {
      try {
        if (fs.readFileSync(file, "utf8").includes(text)) {
          watcher.close()
          resolve()
        }
      } catch {
        // Not written yet.
      }
    }
    fs.writeFileSync(file, "", { flag: "a" })
    const watcher = fs.watch(file, check)
    check()
  })
