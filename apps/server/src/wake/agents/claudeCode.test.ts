// The Claude Code driver (CEL-92): the exact command a woken run is, how recorded modes map (never
// bypassPermissions), where it looks for a conversation, and its process: a turn that ends by itself,
// one that fails, and one stopped by closing its scope, which takes down the whole process group.
// The "CLI" here is a small shell script; the real `claude` never runs in tests.
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import * as Deferred from "effect/Deferred"
import * as Effect from "effect/Effect"
import * as Scope from "effect/Scope"
import * as Exit from "effect/Exit"
import { isAlive } from "../../process/isAlive.ts"
import { tempDataDir } from "../../testing/tempDir.ts"
import type { AgentOutput } from "./AgentDriver.ts"
import { claudeArgs, claudeCode, MAX_TURNS } from "./claudeCode.ts"

const ID = "c14ca1fa-6f0e-4c1b-9d55-5b8c6c1e2a10"

/** A folder with an executable `claude` script holding `body`. */
const stubClaude = (dir: string, body: string) => {
  const bin = path.join(dir, "bin")
  fs.mkdirSync(bin, { recursive: true })
  fs.writeFileSync(path.join(bin, "claude"), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  return bin
}

describe("claudeArgs", () => {
  it("is claude -p --resume with the mode, stream-json, --verbose, the turn limit and the prompt", () => {
    expect(claudeArgs({ nativeId: ID, mode: "auto", prompt: "Lucas acted on CEL-1" })).toEqual([
      "-p",
      "--resume",
      ID,
      "--permission-mode",
      "auto",
      "--output-format",
      "stream-json",
      "--verbose",
      "--max-turns",
      String(MAX_TURNS),
      "Lucas acted on CEL-1",
    ])
    expect(MAX_TURNS).toBe(40)
  })
})

describe("claudeCode.modeFor", () => {
  const driver = claudeCode()
  it("keeps the session's own mode, in Cello's words too; bypassPermissions stays bypass so the host refuses it", () => {
    expect(driver.modeFor("auto")).toEqual({ native: "auto", cello: "auto" })
    expect(driver.modeFor("acceptEdits")).toEqual({ native: "acceptEdits", cello: "edits" })
    expect(driver.modeFor("plan")).toEqual({ native: "plan", cello: "plan" })
    expect(driver.modeFor("default")).toEqual({ native: "default", cello: "ask" })
    expect(driver.modeFor("dontAsk")).toEqual({ native: "dontAsk", cello: "ask" })
    expect(driver.modeFor("bypassPermissions")).toEqual({ native: "bypassPermissions", cello: "bypass" })
  })
  it("with no mode recorded (or one it doesn't know) it asks: default", () => {
    expect(driver.modeFor(null)).toEqual({ native: "default", cello: "ask" })
    expect(driver.modeFor("yolo")).toEqual({ native: "default", cello: "ask" })
  })
  it("declares resume and its modes; no streaming input or permission requests yet", () => {
    expect(driver.capabilities).toEqual({ resume: true, streamingInput: false, permissionRequests: false, modes: ["ask", "edits", "auto", "plan"] })
  })
})

describe("claudeCode.hasConversation", () => {
  it.effect("finds <CLAUDE_CONFIG_DIR>/projects/<any folder>/<session id>.jsonl, and nothing else", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const env = { CLAUDE_CONFIG_DIR: dir }
      const driver = claudeCode()
      expect(yield* driver.hasConversation({ nativeId: ID, cwd: "/repo", env })).toBe(false)
      fs.mkdirSync(path.join(dir, "projects", "-Users-me-repo"), { recursive: true })
      fs.writeFileSync(path.join(dir, "projects", "-Users-me-repo", `${ID}.jsonl`), "{}\n")
      expect(yield* driver.hasConversation({ nativeId: ID, cwd: "/repo", env })).toBe(true)
      // An id that would climb out of the folder is never looked up.
      expect(yield* driver.hasConversation({ nativeId: `../-Users-me-repo/${ID}`, cwd: "/repo", env })).toBe(false)
      // Without CLAUDE_CONFIG_DIR it's HOME/.claude.
      expect(yield* driver.hasConversation({ nativeId: ID, cwd: "/repo", env: { HOME: path.join(dir, "home") } })).toBe(false)
    }))
})

describe("claudeCode.installed", () => {
  it.effect("is true when a `claude` on the environment's PATH can run", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const driver = claudeCode()
      expect(yield* driver.installed({ PATH: path.join(dir, "nothing") })).toBe(false)
      expect(yield* driver.installed({ PATH: stubClaude(dir, "exit 0") })).toBe(true)
    }))
})

describe("claudeCode.open", () => {
  const run = (dir: string, bin: string, outputs: AgentOutput[], onReady?: Deferred.Deferred<void>) =>
    Effect.gen(function* () {
      const handle = yield* claudeCode().open({
        nativeId: ID,
        cwd: dir,
        mode: "auto",
        env: { PATH: `${bin}:/usr/bin:/bin`, CELLO_WOKEN: "1" },
        onOutput: (o) => {
          outputs.push(o)
          if (onReady && o.line === "ready") Deferred.doneUnsafe(onReady, Exit.void)
        },
        onEvent: () => {},
      })
      return yield* handle.resume("Lucas acted on CEL-1")
    })

  it.effect("runs in the folder with the args and env, hands over each line, and ends completed on exit 0", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const bin = stubClaude(dir, `echo "{\\"cwd\\":\\"$(pwd)\\",\\"woken\\":\\"$CELLO_WOKEN\\",\\"args\\":\\"$*\\"}"\necho oops >&2`)
      const outputs: AgentOutput[] = []
      const ended = yield* Effect.scoped(Effect.flatMap(run(dir, bin, outputs), (turn) => turn.ended))
      expect(ended).toEqual({ outcome: "completed", exitCode: 0, error: null })
      const line = JSON.parse(outputs.find((o) => o.stream === "stdout")!.line)
      expect(line).toEqual({ cwd: fs.realpathSync(dir), woken: "1", args: `${claudeArgs({ nativeId: ID, mode: "auto", prompt: "Lucas acted on CEL-1" }).join(" ")}` })
      expect(outputs.filter((o) => o.stream === "stderr")).toEqual([{ stream: "stderr", line: "oops" }])
    }))

  it.effect("a non-zero exit is a failed turn, with the CLI's result as the error when it gave one", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const bin = stubClaude(dir, `echo '{"type":"result","subtype":"error_max_turns","is_error":true}'\nexit 3`)
      const ended = yield* Effect.scoped(Effect.flatMap(run(dir, bin, []), (turn) => turn.ended))
      expect(ended).toEqual({ outcome: "failed", exitCode: 3, error: "claude ended with error_max_turns (exit 3)" })
    }))

  it.effect("closing the scope stops it: SIGTERM to the whole process group, the turn ends interrupted", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const childFile = path.join(dir, "child.pid")
      // A child of its own, like the tools Claude runs, then "ready", then it waits.
      const bin = stubClaude(dir, `sleep 300 &\necho $! > "${childFile}"\necho ready\nwait`)
      const ready = yield* Deferred.make<void>()
      const scope = yield* Scope.make()
      const turn = yield* run(dir, bin, [], ready).pipe(Scope.provide(scope))
      yield* Deferred.await(ready)
      const child = Number(fs.readFileSync(childFile, "utf8"))
      expect(isAlive(child)).toBe(true)
      yield* Scope.close(scope, Exit.void)
      // The turn ends once every process holding its output has closed it: the child too, or this would
      // wait out its 300 s.
      expect(yield* turn.ended).toMatchObject({ outcome: "interrupted" })
      expect(isAlive(turn.pid!)).toBe(false)
    }))

  it.effect("a CLI that can't start is AgentStartFailed", () =>
    Effect.gen(function* () {
      const dir = yield* tempDataDir
      const result = yield* Effect.scoped(Effect.flip(run(dir, path.join(dir, "no-bin"), [])))
      expect(result._tag).toBe("AgentStartFailed")
    }))
})
