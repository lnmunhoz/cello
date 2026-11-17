// Merge after I approve (CEL-143), the whole way through the real CLI and server: a new project with a
// repository merges after approval, `cello context` says so, the agent submits (with its PR link), Lucas
// approves, the agent's `cello inbox` hands it the approval to merge, and `cello task done` moves the task
// to Done and ends the claim. `cello task done` before the approval is refused with what to do instead.
import { newCommandId } from "@cello/client/client"
import { writePng } from "@cello/server/testing/media"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo } from "./cli.ts"

const SESSION = "7d0c1e2a-1430-4e6b-9a51-cel143merge0"
const claude = { CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_PID: String(process.pid) }

const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const repo = gitRepo(dataDir, "app")
  const human = yield* connect(port)
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  // No setting given: a new project with a repository merges after approval.
  const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "App", key: "APP", repoPath: repo })
  return { port, repo, human, project, agent: cello({ port, env: claude, cwd: repo }) }
})

describe("merge after I approve", () => {
  it.live("submit, Lucas approves, the agent's inbox says merge it now, `cello task done` finishes it", () =>
    Effect.gen(function* () {
      const { agent, human, repo, project } = yield* setup
      expect(project.mergeAfterApproval).toBe(true)
      expect((yield* agent("context")).out).toContain(
        "Merge after approval  on: submit before you merge (attach the PR with --link when this project uses PRs); the human's Approve tells you to merge, then `cello task done KEY`",
      )

      yield* agent("task", "create", "Checkout button")
      yield* agent("task", "claim", "APP-1")
      writePng(repo, "button.png")
      const submitted = yield* agent(
        "task", "submit", "APP-1", "--summary", "The checkout button", "--step", "Open the cart",
        "--attach", "button.png", "--link", "https://github.com/acme/app/pull/7", "--caption", "The PR",
      )
      expect(submitted.failure).toBeNull()

      // Not approved yet: nothing to finish.
      expect((yield* agent("task", "done", "APP-1")).failure).toBe(
        "APP-1 isn't approved: `cello task done` finishes a task the human approved in a project that merges after approval (Approved · merging). " +
          "Hand work in with `cello task submit APP-1`.",
      )

      yield* human["review.approve"]({ commandId: newCommandId(), key: "APP-1", note: "Looks right" })
      const detail = JSON.parse((yield* agent("task", "get", "APP-1", "--json")).out)
      expect(detail.task).toMatchObject({ stage: "merging", assigneeSessionId: expect.any(String) })
      expect(detail.statuses.find((s: { id: string }) => s.id === detail.task.statusId).name).toBe("In Review")

      const inbox = yield* agent("inbox", "--new")
      expect(inbox.failure).toBeNull()
      expect(inbox.out).toContain("Lucas approved a task in Cello: merge it now.")
      expect(inbox.out).toContain("    Lucas approved APP-1: merge it now, then `cello task done APP-1`.\n    Looks right")
      // Handed over once.
      expect((yield* agent("inbox", "--new")).out).toBe("")

      const done = yield* agent("task", "done", "APP-1")
      expect(done).toEqual({ out: "Done APP-1  In Review → Done  Checkout button\n  Your claim on it ended.", failure: null })
      const after = JSON.parse((yield* agent("task", "get", "APP-1", "--json")).out)
      expect(after.task).toMatchObject({ stage: null, assigneeSessionId: null })
      expect(after.statuses.find((s: { id: string }) => s.id === after.task.statusId).name).toBe("Done")
    }).pipe(Effect.scoped))

  it.live("with the setting off, `cello context` says to merge before submitting", () =>
    Effect.gen(function* () {
      const { agent, human, project } = yield* setup
      yield* human["project.update"]({ commandId: newCommandId(), id: project.id, mergeAfterApproval: false })
      expect((yield* agent("context")).out).toContain(
        "Merge after approval  off: merge before you submit; the human's Approve moves the task to Done",
      )
    }).pipe(Effect.scoped))
})
