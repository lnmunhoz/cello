// `cello task stage` (CEL-35) against a real server: the claim holder sets where its work is inside In
// Progress, others are refused, submit clears it. And "last changed" (CEL-5) in `cello task get`.
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo } from "./cli.ts"

const SESSION = "8a41c9e2-417a-4167-acfe-2d66080fcae0"
const claude = { CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_PID: String(process.pid), CLAUDE_CODE_ENTRYPOINT: "cli" }
const rival = { CLAUDE_CODE_SESSION_ID: "9f2c1a7b-rival", CLAUDE_PID: String(process.pid) }

const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port)
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })
  return {
    agent: cello({ port, env: claude, cwd: path.join(repo, "src") }),
    other: cello({ port, env: rival, cwd: repo }),
    me: cello({ port, env: { CELLO_SESSION: "me" }, cwd: repo }),
  }
})

describe("cello task stage", () => {
  it.live("the claim holder moves its task through the stages; list and get show where it is", () =>
    Effect.gen(function* () {
      const { agent, me } = yield* setup
      yield* me("task", "create", "Presence on cards")
      yield* agent("task", "claim", "CEL-1")

      expect(yield* agent("task", "stage", "CEL-1", "building")).toEqual({ out: "CEL-1 is now Building  (In Progress  Presence on cards)", failure: null })
      expect(yield* agent("task", "stage", "CEL-1", "Review")).toEqual({ out: "CEL-1 is now Agent review  (In Progress  Presence on cards)", failure: null })
      expect((yield* agent("task", "list")).out).toBe("CEL-1  In Progress · Agent review  Presence on cards  · Claude Code session 8a41c9e2")

      const detail = (yield* agent("task", "get", "CEL-1")).out
      expect(detail).toContain("Status: In Progress · Stage: Agent review · Priority: None")
      expect(detail).toContain("Last changed by Claude Code session 8a41c9e2, just now")
      expect(detail).toContain("Claude Code session 8a41c9e2 set the stage to Agent review")

      const json = JSON.parse((yield* agent("task", "stage", "CEL-1", "fixing", "--json")).out)
      expect(json.result).toMatchObject({ key: "CEL-1", stage: "fixing" })

      expect(yield* agent("task", "stage", "CEL-1", "--clear")).toEqual({ out: "Cleared the stage of CEL-1  (In Progress  Presence on cards)", failure: null })
      expect((yield* agent("task", "list")).out).toBe("CEL-1  In Progress  Presence on cards  · Claude Code session 8a41c9e2")
    }))

  it.live("explains what's wrong: no stage named, an unknown one, another session's task, a task outside In Progress", () =>
    Effect.gen(function* () {
      const { agent, other, me } = yield* setup
      yield* me("task", "create", "Presence on cards")
      yield* me("task", "create", "Still in Todo")
      yield* agent("task", "claim", "CEL-1")

      expect((yield* agent("task", "stage", "CEL-1")).failure).toBe(
        "Name a stage: building, review, fixing or merged (e.g. `cello task stage CEL-1 review`), or --clear to remove it.",
      )
      expect((yield* agent("task", "stage", "CEL-1", "deploying")).failure).toBe(
        "No stage \"deploying\". Use building, review, fixing or merged.",
      )
      expect((yield* agent("task", "stage", "CEL-1", "review", "--clear")).failure).toBe(
        "Pass a stage or --clear, not both.",
      )
      expect((yield* other("task", "stage", "CEL-1", "review")).failure).toBe(
        "CEL-1 is claimed by another session: only the session holding the claim sets its stage.",
      )
      expect((yield* other("task", "stage", "CEL-2", "review")).failure).toBe(
        "CEL-2 isn't claimed: claim it first (`cello task claim CEL-2`).",
      )
      expect((yield* me("task", "stage", "CEL-2", "review")).failure).toBe(
        "CEL-2 is in Todo; a stage is only for tasks in In Progress.",
      )
    }))

  it.live("submitting the task clears its stage", () =>
    Effect.gen(function* () {
      const { agent, me } = yield* setup
      yield* me("task", "create", "Presence on cards")
      yield* agent("task", "claim", "CEL-1")
      yield* agent("task", "stage", "CEL-1", "merged")
      const submitted = yield* agent("task", "submit", "CEL-1", "--summary", "Done", "--step", "Look", "--link", "https://example.com/pr/1")
      expect(submitted.failure).toBeNull()
      const after = JSON.parse((yield* agent("task", "get", "CEL-1", "--json")).out)
      expect(after.task).toMatchObject({ stage: null })
      expect((yield* agent("task", "get", "CEL-1")).out).not.toContain("Stage:")
    }))
})
