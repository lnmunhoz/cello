// CEL-113: `cello milestone list|show|create|edit|close`, `--milestone` on `task create|edit|list`, and
// milestones in `cello task get` and `cello context`, against a real server. Agents create, edit and
// assign; only the human closes.
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo } from "./cli.ts"

const claude = { CLAUDE_CODE_SESSION_ID: "2fd0505c-417a-4167-acfe-2d66080fcae0", CLAUDE_PID: String(process.pid) }

/** Project CEL linked to a git repo, with CEL-1 "Sidebar" (Todo) and CEL-2 "Search" (Done). */
const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port)
  const snapshot = yield* human["snapshot.get"]({})
  const workspaceId = snapshot.workspaces[0]!.id
  const done = snapshot.statuses.find((s) => s.name === "Done")!
  const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })
  yield* human["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Sidebar" })
  yield* human["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Search", statusId: done.id })
  return {
    human,
    agent: cello({ port, env: claude, cwd: path.join(repo, "src") }),
    me: cello({ port, env: { CELLO_SESSION: "me" }, cwd: repo }),
  }
})

describe("cello milestone", () => {
  it.live("create, list, edit, and show with its tasks; an agent assigns tasks with --milestone", () =>
    Effect.gen(function* () {
      const { agent } = yield* setup
      expect(yield* agent("milestone", "list")).toEqual({
        out: "No milestones yet in CEL. Make one with `cello milestone create <name> --goal \"…\"`.",
        failure: null,
      })
      expect(yield* agent("milestone", "create", "M2")).toEqual({ out: "Created milestone M2", failure: null })
      expect(yield* agent("milestone", "create", "M3", "--goal", "Watching agents", "--due", "2026-12-01"))
        .toEqual({ out: "Created milestone M3 · due 2026-12-01 · Watching agents", failure: null })
      expect((yield* agent("milestone", "create", "m3")).failure).toBe(`There's already a milestone named "M3" in CEL.`)
      expect((yield* agent("milestone", "create", "M4", "--due", "soon")).failure).toBe(`--due takes a date like 2026-12-01, or none to clear it; "soon" isn't one.`)

      expect(yield* agent("task", "edit", "CEL-1", "--milestone", "m3")).toEqual({ out: "CEL-1 is in M3  Sidebar", failure: null })
      expect(yield* agent("task", "edit", "CEL-2", "--milestone", "M3")).toEqual({ out: "CEL-2 is in M3  Search", failure: null })
      expect(yield* agent("task", "create", "Filters", "--milestone", "M3")).toEqual({ out: "Created CEL-3  Todo  Filters  · M3", failure: null })
      expect((yield* agent("task", "edit", "CEL-1", "--milestone", "M9")).failure).toBe(
        `No milestone named "M9" in CEL (did you mean M2 or M3?). Milestones: M2, M3 (or none). Nothing was changed; \`cello milestone create M9\` makes it.`,
      )

      expect(yield* agent("milestone", "list")).toEqual({
        out: [
          "M2  open  0 of 0 done",
          "M3  open  1 of 3 done · 33%  due 2026-12-01 · Watching agents",
        ].join("\n"),
        failure: null,
      })

      // Reorder: M3 first.
      expect(yield* agent("milestone", "edit", "M3", "--before", "M2")).toEqual({ out: "Updated milestone M3 · due 2026-12-01 · Watching agents", failure: null })
      expect(yield* agent("milestone", "edit", "M3", "--due", "none", "--goal", "Watch agents work")).toEqual({ out: "Updated milestone M3 · Watch agents work", failure: null })
      expect(yield* agent("milestone", "edit", "M3", "--goal", "Watch agents work")).toEqual({ out: "Milestone M3 is already like that.", failure: null })
      expect((yield* agent("milestone", "edit", "M3")).failure).toBe(
        "Say what to change: --name, --goal \"…\", --due 2026-12-01 (or none), --before or --after another milestone.",
      )
      expect((yield* agent("milestone", "list")).out.split("\n").map((l) => l.split("  ")[0])).toEqual(["M3", "M2"])

      const shown = (yield* agent("milestone", "show", "m3")).out
      expect(shown).toBe([
        "M3 · open",
        "Watch agents work",
        "1 of 3 done · 33%: 2 to do",
        "",
        "CEL-1  Todo  Sidebar",
        "CEL-3  Todo  Filters",
        "CEL-2  Done  Search",
      ].join("\n"))

      // A task's milestone shows in `task get` and its history; `--milestone none` takes it out.
      const got = (yield* agent("task", "get", "CEL-1")).out
      expect(got.split("\n")[1]).toBe("Status: Todo · Priority: None · Milestone: M3")
      expect(got).toContain("put it in M3")
      expect(yield* agent("task", "edit", "CEL-1", "--milestone", "none")).toEqual({ out: "CEL-1 has no milestone now  Sidebar", failure: null })
      expect((yield* agent("task", "get", "CEL-1")).out).toContain("took it out of M3")

      // `task list --milestone`: open tasks in it by default, or none.
      expect((yield* agent("task", "list", "--milestone", "M3")).out).toBe("CEL-3  Todo  Filters")
      expect((yield* agent("task", "list", "--milestone", "none")).out).toBe("CEL-1  Todo  Sidebar")
      expect((yield* agent("task", "list", "--milestone", "M2")).out).toBe("No open tasks in milestone M2 in CEL.")

      // --milestone with other flags: two writes, and --json prints both.
      expect(yield* agent("task", "edit", "CEL-1", "--title", "Sidebar v2", "--milestone", "M2")).toEqual({
        out: "Edited CEL-1  Sidebar v2\nCEL-1 is in M2  Sidebar v2",
        failure: null,
      })
      const both = JSON.parse((yield* agent("task", "edit", "CEL-1", "--priority", "high", "--milestone", "M3", "--json")).out)
      expect(both.update.result).toMatchObject({ key: "CEL-1", priority: 2 })
      const m3 = JSON.parse((yield* agent("milestone", "show", "M3", "--json")).out).milestone
      expect(both.moved.result.milestoneId).toBe(m3.id)
      expect(both.moved.seq).not.toBeNull()
      // --milestone alone prints its write, with no update.
      const alone = JSON.parse((yield* agent("task", "edit", "CEL-1", "--milestone", "none", "--json")).out)
      expect(alone).toMatchObject({ update: null, moved: { result: { key: "CEL-1", milestoneId: null } } })

      // `task create --milestone none` is a task without one, as docs/cli.md's `<name|none>` says.
      expect(yield* agent("task", "create", "Loose", "--milestone", "none")).toEqual({ out: "Created CEL-4  Todo  Loose", failure: null })
      expect(JSON.parse((yield* agent("task", "get", "CEL-4", "--json")).out).task.milestoneId).toBeNull()
    }).pipe(Effect.scoped))

  it.live("context lists the open milestones with done/total; only the human closes one", () =>
    Effect.gen(function* () {
      const { agent, me } = yield* setup
      yield* agent("milestone", "create", "M2")
      yield* agent("milestone", "create", "M3", "--due", "2026-12-01")
      yield* agent("task", "edit", "CEL-1", "--milestone", "M3")
      yield* agent("task", "edit", "CEL-2", "--milestone", "M3")
      const context = (yield* agent("context")).out.split("\n")
      expect(context.find((l) => l.startsWith("Milestones"))).toBe("Milestones  M2 0/0 done · M3 1/2 done (due 2026-12-01)")

      expect(yield* agent("milestone", "close", "M3")).toEqual({
        out: "",
        failure: "Only Lucas can close a milestone. When its work looks done, say so on your task's card; Lucas closes it.",
      })
      expect(yield* me("milestone", "close", "M3")).toEqual({ out: "Closed milestone M3 (1 of 2 done · 50%).", failure: null })
      expect(yield* me("milestone", "close", "M3")).toEqual({ out: "Milestone M3 is already closed.", failure: null })
      expect((yield* agent("context")).out.split("\n").find((l) => l.startsWith("Milestones"))).toBe("Milestones  M2 0/0 done")
      expect((yield* agent("milestone", "list")).out.split("\n")[1]).toMatch(/^M3 {2}closed {2}1 of 2 done · 50% {2}closed just now$/)
      // A closed milestone takes no new tasks; the human reopens it.
      expect((yield* agent("milestone", "reopen", "M3")).failure).toBe(
        "Only Lucas can reopen a milestone. When its work looks done, say so on your task's card; Lucas closes it.",
      )
      expect((yield* agent("task", "create", "Late", "--milestone", "M3")).failure).toBe(
        "M3 is closed: put tasks in an open milestone, or reopen M3 first.",
      )
      expect(yield* me("milestone", "reopen", "M3")).toEqual({ out: "Reopened milestone M3.", failure: null })
      expect((yield* agent("task", "create", "Late", "--milestone", "M3")).out).toBe("Created CEL-3  Todo  Late  · M3")
    }).pipe(Effect.scoped))
})
