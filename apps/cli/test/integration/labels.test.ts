// CEL-56: `cello label list/create/update/archive` and `cello task label CEL-n +area -area`, against a real server.
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { colorFromSeed } from "@cello/shared/color"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo } from "./cli.ts"

const claude = { CLAUDE_CODE_SESSION_ID: "2fd0505c-417a-4167-acfe-2d66080fcae0", CLAUDE_PID: String(process.pid) }
const rival = { CLAUDE_CODE_SESSION_ID: "9f2c1a7b-rival", CLAUDE_PID: String(process.pid) }

/** Project CEL linked to a git repo, labels ui and server, and CEL-1 carrying ui. */
const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port)
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })
  const { result: ui } = yield* human["label.create"]({ commandId: newCommandId(), workspaceId, name: "ui", color: "#3B82F6" })
  yield* human["label.create"]({ commandId: newCommandId(), workspaceId, name: "server", color: "#22C55E" })
  yield* human["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Sidebar", labelIds: [ui.id] })
  return {
    human,
    workspaceId,
    agent: cello({ port, env: claude, cwd: path.join(repo, "src") }),
    other: cello({ port, env: rival, cwd: repo }),
    me: cello({ port, env: { CELLO_SESSION: "me" }, cwd: repo }),
  }
})

const json = <T = any>(output: { out: string; failure: string | null }): T => {
  expect(output.failure).toBeNull()
  return JSON.parse(output.out) as T
}

describe("cello label", () => {
  it.live("list shows each label's colour and how many tasks carry it; create makes one; update recolours it", () =>
    Effect.gen(function* () {
      const { agent } = yield* setup
      expect(yield* agent("label", "list")).toEqual({
        out: ["server  #22C55E  no tasks", "ui      #3B82F6  1 task in CEL"].join("\n"),
        failure: null,
      })

      expect(yield* agent("label", "create", "board", "--color", "#5b9a74")).toEqual({ out: "Created label board  #5B9A74", failure: null })
      const made = json(yield* agent("label", "create", "misc", "--json"))
      expect(made.result).toMatchObject({ name: "misc", color: colorFromSeed("misc") })

      expect(yield* agent("label", "update", "Server", "--color", "#8D7B68")).toEqual({ out: "Updated label server  #8D7B68", failure: null })
      expect(yield* agent("label", "update", "server", "--color", "#8D7B68")).toEqual({ out: "Label server is already #8D7B68.", failure: null })
      expect(yield* agent("label", "update", "misc", "--name", "chore")).toEqual({ out: "Updated label chore  " + colorFromSeed("misc"), failure: null })

      const list = json(yield* agent("label", "list", "--json"))
      expect(list.labels.map((l: any) => [l.label.name, l.label.color, l.tasks])).toEqual([
        ["board", "#5B9A74", 0],
        ["chore", colorFromSeed("misc"), 0],
        ["server", "#8D7B68", 0],
        ["ui", "#3B82F6", 1],
      ])
    }).pipe(Effect.scoped))

  it.live("a name that's taken in any case is refused, as are a bad colour and an unknown label", () =>
    Effect.gen(function* () {
      const { agent } = yield* setup
      expect(yield* agent("label", "create", "UI")).toEqual({
        out: "",
        failure: `There's already a label named "ui". Nothing was changed; \`cello label list\` shows every label, archived ones too.`,
      })
      expect((yield* agent("label", "create", "board", "--color", "blue")).failure).toBe("--color must be a colour like #3B82F6.")
      expect((yield* agent("label", "update", "bord", "--color", "#000000")).failure).toBe(
        `No label named "bord". Labels: server, ui. \`cello label list\` shows them all.`,
      )
      expect((yield* agent("label", "update", "ui")).failure).toBe("Say what to change: --color #3B82F6, --name new-name, --group area, or several.")
      expect((yield* agent("label", "list")).out).not.toContain("UI ")
    }).pipe(Effect.scoped))

  it.live("--group puts a label in kind, area or milestone (CEL-52); the list shows the groups; an unknown group is refused", () =>
    Effect.gen(function* () {
      const { agent } = yield* setup
      expect(yield* agent("label", "create", "bug", "--color", "#EF4444", "--group", "kind")).toEqual({ out: "Created label bug  #EF4444  Kind", failure: null })
      expect(yield* agent("label", "create", "M2", "--color", "#26B5CE", "--group", "Milestone")).toEqual({ out: "Created label M2  #26B5CE  Milestone", failure: null })
      expect(yield* agent("label", "update", "server", "--group", "area")).toEqual({ out: "Updated label server  #22C55E  Area", failure: null })
      expect(yield* agent("label", "update", "server", "--group", "area")).toEqual({ out: "Label server is already in Area.", failure: null })
      expect(yield* agent("label", "update", "bug", "--group", "kind", "--color", "#EF4444")).toEqual({ out: "Label bug is already #EF4444, in Kind.", failure: null })

      expect(yield* agent("label", "list")).toEqual({
        out: [
          "Kind",
          "  bug     #EF4444  no tasks",
          "",
          "Area",
          "  server  #22C55E  no tasks",
          "",
          "Milestone",
          "  M2      #26B5CE  no tasks",
          "",
          "Other",
          "  ui      #3B82F6  1 task in CEL",
        ].join("\n"),
        failure: null,
      })
      const list = json(yield* agent("label", "list", "--json"))
      expect(list.labels.map((l: any) => [l.label.name, l.label.group])).toEqual([["M2", "milestone"], ["bug", "kind"], ["server", "area"], ["ui", "none"]])

      // Back to none, and refused names change nothing.
      expect(yield* agent("label", "update", "server", "--group", "none")).toEqual({ out: "Updated label server  #22C55E  Other", failure: null })
      const unknown = `No group named "theme". Groups: kind, area, milestone, none (shown as Other). Nothing was changed.`
      expect((yield* agent("label", "update", "server", "--group", "theme")).failure).toBe(unknown)
      expect((yield* agent("label", "create", "docs", "--group", "theme")).failure).toBe(unknown)
      expect((yield* agent("label", "list")).out).not.toContain("docs")
    }).pipe(Effect.scoped))

  it.live("archive hides a label from cards, pickers and new tasks; tasks keep the link, and the name stays taken", () =>
    Effect.gen(function* () {
      const { agent } = yield* setup
      expect(yield* agent("label", "archive", "UI")).toEqual({
        out: "Archived label ui. It no longer shows on the 1 task in CEL that carries it (the task keeps the link underneath), " +
          "can't be added to tasks, and its name stays taken.",
        failure: null,
      })
      expect(yield* agent("label", "archive", "ui")).toEqual({ out: "Label ui was already archived.", failure: null })
      expect((yield* agent("label", "list")).out).toBe(
        ["server  #22C55E  no tasks", "", "Archived (hidden from cards and pickers; tasks keep the link): ui (1 task in CEL)"].join("\n"),
      )
      expect((yield* agent("context")).out).toContain("Labels    server\n")
      expect((yield* agent("task", "get", "CEL-1")).out).toContain("Status: Todo · Priority: None\n")
      expect((yield* agent("task", "label", "CEL-1", "+ui")).failure).toContain(`No label named "ui"`)
      expect((yield* agent("label", "create", "ui")).failure).toContain(`There's already an archived label named "ui"`)
      expect((yield* agent("label", "archive", "nope")).failure).toBe(`No label named "nope". Labels: server, ui. \`cello label list\` shows them all.`)
    }).pipe(Effect.scoped))
})

describe("cello task label", () => {
  it.live("adds and removes labels by name in one change, any case, with --json anywhere", () =>
    Effect.gen(function* () {
      const { agent } = yield* setup
      yield* agent("label", "create", "board")
      yield* agent("label", "create", "feature")
      expect(yield* agent("task", "label", "cel-1", "+Feature", "+board", "-ui")).toEqual({
        out: "CEL-1 labels: board, feature (added board and feature; removed ui)",
        failure: null,
      })
      const detail = json(yield* agent("task", "get", "CEL-1", "--json"))
      const changes = detail.history.filter((e: { type: string }) => e.type === "task.labels_changed")
      expect(changes).toHaveLength(1)
      expect(changes[0]).toMatchObject({ added: [expect.any(String), expect.any(String)], removed: [expect.any(String)] })
      expect((yield* agent("task", "get", "CEL-1")).out).toContain("Status: Todo · Priority: None · Labels: board, feature")

      expect(yield* agent("task", "label", "CEL-1", "+board", "-ui")).toEqual({ out: "CEL-1 already has these labels: board, feature", failure: null })
      expect(json(yield* agent("task", "label", "--json", "CEL-1", "-board", "-feature")).result.labelIds).toEqual([])
      expect(json(yield* agent("task", "label", "CEL-1", "+ui", "--json")).seq).toEqual(expect.any(Number))
    }).pipe(Effect.scoped))

  it.live("an unknown name is refused with close matches and nothing changes; so are a bare name and a label added and removed at once", () =>
    Effect.gen(function* () {
      const { agent } = yield* setup
      yield* agent("label", "create", "board")
      const before = json(yield* agent("task", "get", "CEL-1", "--json")).task.version
      expect((yield* agent("task", "label", "CEL-1", "+bord", "+zebra", "-ui")).failure).toBe(
        `No label named "bord" (did you mean board?) and none named "zebra". Nothing was changed. ` +
          "Labels: board, server, ui. Make a new one with `cello label create <name>`.",
      )
      expect(json(yield* agent("task", "get", "CEL-1", "--json")).task.version).toBe(before)
      expect((yield* agent("label", "list", "--json")).out).not.toContain("zebra")
      expect((yield* agent("task", "label", "CEL-1", "board")).failure).toBe(
        `Each change starts with + to add a label or - to remove one, e.g. +board -ui; "board" has neither.`,
      )
      expect((yield* agent("task", "label", "CEL-1", "+board", "-board")).failure).toBe("A label can't be added and removed at once.")
      expect((yield* agent("task", "label", "CEL-1")).failure).toBe("Say which labels to add and remove, e.g. `cello task label CEL-12 +board -ui`.")
      expect((yield* agent("task", "label", "CEL-9", "+board")).failure).toBe("No task CEL-9. Run `cello task list` to see open tasks.")
    }).pipe(Effect.scoped))

  it.live("anyone may relabel: an agent on a task another session holds keeps that claim; a human change ends it, as any of his changes does", () =>
    Effect.gen(function* () {
      const { agent, other, me } = yield* setup
      yield* agent("label", "create", "board")
      yield* other("task", "claim", "CEL-1")
      expect((yield* agent("task", "label", "CEL-1", "+board")).out).toBe("CEL-1 labels: ui, board (added board)")
      expect((yield* agent("task", "get", "CEL-1")).out).toContain("Claimed by: Claude Code session 9f2c1a7b")
      expect((yield* me("task", "label", "CEL-1", "-board")).out).toBe("CEL-1 labels: ui (removed board)")
      expect((yield* other("context")).out).toContain("Claims you lost\n  CEL-1  ended when Lucas changed it")
    }).pipe(Effect.scoped))
})
