// CEL-77 against a real server: Lucas's 👍 on an agent's comment reaches that session once through
// `cello inbox`, and taking it back first takes it back; agents react with `cello task react`, by comment
// id or `last` (Lucas's newest comment); `cello task get` shows each comment's id and its reactions.
import { newCommandId } from "@cello/client/client"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo } from "./cli.ts"

const X = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const claude = (session: string) => ({ CLAUDE_CODE_SESSION_ID: session, CLAUDE_PID: String(process.pid) })

/** Project CEL; session X created CEL-1, claimed it, and asked something on it. */
const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port)
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })
  const x = cello({ port, env: claude(X), cwd: repo })
  const me = cello({ port, env: { CELLO_SESSION: "me" }, cwd: repo })
  yield* x("task", "create", "Reactions reach agents")
  yield* x("task", "claim", "CEL-1")
  yield* x("task", "comment", "CEL-1", "Built the picker. Shall I merge it?")
  const commentId = JSON.parse((yield* x("task", "get", "CEL-1", "--json")).out).comments[0].id as string
  return { x, me, commentId }
})

describe("cello task react", () => {
  it.live("Lucas's 👍 on X's comment reaches X once; task get shows it under the comment", () =>
    Effect.gen(function* () {
      const { x, me, commentId } = yield* setup
      expect(yield* me("task", "react", "CEL-1", commentId, "👍")).toEqual({
        out: `Reacted 👍 to Claude Code session 2fd0505c's comment on CEL-1: "Built the picker. Shall I merge it?"`,
        failure: null,
      })

      expect(yield* x("inbox", "--new")).toEqual({
        out: [
          "Lucas reacted to your comment in Cello:",
          "",
          "CEL-1  Reactions reach agents",
          "  Lucas reacted 👍 to your comment, just now",
          "    \"Built the picker. Shall I merge it?\"",
          "",
          "A reaction is Lucas's quick answer to your comment: take it as his reply; there's no need to answer it on the card.",
        ].join("\n"),
        failure: null,
      })
      expect(yield* x("inbox", "--new")).toEqual({ out: "", failure: null })

      const shown = (yield* x("task", "get", "CEL-1")).out
      expect(shown).toContain(
        `Comments (1)\n  Claude Code session 2fd0505c · just now · id ${commentId}\n    Built the picker. Shall I merge it?\n    Reactions: 👍 Lucas`,
      )
      // A reaction is no change to the task: the history doesn't list it.
      expect(shown).not.toContain("reacted")
    }).pipe(Effect.scoped))

  it.live("taking it back before X reads it takes the item back", () =>
    Effect.gen(function* () {
      const { x, me, commentId } = yield* setup
      yield* me("task", "react", "CEL-1", commentId, "👍")
      expect(yield* me("task", "react", "CEL-1", commentId, "👍", "--remove")).toEqual({
        out: `Took back your 👍 on Claude Code session 2fd0505c's comment on CEL-1`,
        failure: null,
      })
      expect(yield* x("inbox", "--new")).toEqual({ out: "", failure: null })
    }).pipe(Effect.scoped))

  it.live("an agent reacts to Lucas's newest comment with `last`, again is a no-op, --remove takes it back", () =>
    Effect.gen(function* () {
      const { x, me } = yield* setup
      yield* me("task", "comment", "CEL-1", "Yes, merge it")
      yield* x("task", "comment", "CEL-1", "Merging now")
      expect(yield* x("task", "react", "CEL-1", "last", "✅")).toEqual({
        out: `Reacted ✅ to Lucas's comment on CEL-1: "Yes, merge it"`,
        failure: null,
      })
      expect((yield* x("task", "react", "CEL-1", "last", "✅")).out).toBe(`You had already reacted ✅ to Lucas's comment on CEL-1`)
      expect((yield* x("task", "get", "CEL-1")).out).toContain("Yes, merge it\n    Reactions: ✅ Claude Code session 2fd0505c")
      expect((yield* x("task", "react", "CEL-1", "last", "✅", "--remove")).out).toBe(`Took back your ✅ on Lucas's comment on CEL-1`)
      expect((yield* x("task", "react", "CEL-1", "last", "✅", "--remove")).out).toBe(`No ✅ of yours on Lucas's comment on CEL-1`)
    }).pipe(Effect.scoped))

  it.live("says what to do when the emoji, the comment or `last` doesn't fit", () =>
    Effect.gen(function* () {
      const { x, commentId } = yield* setup
      expect((yield* x("task", "react", "CEL-1", commentId, "ok")).failure).toBe("A reaction must be one emoji, like 👍.")
      expect((yield* x("task", "react", "CEL-1", "01NOPE", "👍")).failure).toBe(
        "No comment 01NOPE on CEL-1. `cello task get CEL-1` shows each comment with its id.",
      )
      expect((yield* x("task", "react", "CEL-1", "last", "👍")).failure).toBe(
        "Lucas hasn't commented on CEL-1 yet. Pass a comment id instead; `cello task get CEL-1` shows each comment with its id.",
      )
    }).pipe(Effect.scoped))
})
