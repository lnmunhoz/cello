// CEL-56's apply script: the table is well formed, each task's plan is right, and against a real
// server it creates the labels, labels the tasks, archives ui, and a second run changes nothing.
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { apply, AREA_GROUPS, type Cli, KIND_COLORS, LABELS, planTask, TABLE } from "../../../../scripts/apply-cel56-labels.ts"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo, TEST_HOME } from "./cli.ts"

const SCRIPT = path.resolve(import.meta.dirname, "../../../../scripts/apply-cel56-labels.ts")
const BIN = path.resolve(import.meta.dirname, "../../src/bin.ts")
const SESSION = "2fd0505c-417a-4167-acfe-2d66080fcae0"

describe("the CEL-56 table", () => {
  it("gives every task from CEL-1 to CEL-59 but canceled CEL-40 one kind and at least one known area", () => {
    const areas = new Set<string>(Object.values(AREA_GROUPS).flatMap((g) => g.areas))
    const keys = Object.keys(TABLE)
    expect(keys).toEqual(Array.from({ length: 59 }, (_, i) => `CEL-${i + 1}`).filter((k) => k !== "CEL-40"))
    expect(TABLE["CEL-58"]).toEqual({ kind: "feature", areas: ["search", "board"] })
    expect(TABLE["CEL-59"]).toEqual({ kind: "chore", areas: ["tests", "data"] })
    for (const row of Object.values(TABLE)) {
      expect(Object.keys(KIND_COLORS)).toContain(row.kind)
      expect(row.areas.length).toBeGreaterThan(0)
      for (const area of row.areas) expect(areas.has(area)).toBe(true)
    }
  })

  it("has 20 labels: 5 kinds in their own colours, 15 areas in one colour per group", () => {
    expect(LABELS).toHaveLength(20)
    expect(new Set(LABELS.map((l) => l.name)).size).toBe(20)
    expect(LABELS.slice(0, 5)).toEqual([
      { name: "feature", color: "#3B82F6" },
      { name: "bug", color: "#EF4444" },
      { name: "polish", color: "#8B5CF6" },
      { name: "chore", color: "#6B7280" },
      { name: "docs", color: "#14B8A6" },
    ])
    expect(new Set(LABELS.slice(5).map((l) => l.color)).size).toBe(3)
  })
})

describe("planTask", () => {
  it("adds the row's kind and areas, takes off ui and kinds or areas the row doesn't give, and leaves M2 alone", () => {
    expect(planTask(["ui", "m2", "server", "bug"], { kind: "feature", areas: ["board"] })).toEqual({
      add: ["feature", "board"],
      remove: ["ui", "server", "bug"],
    })
    expect(planTask(["server", "m2"], { kind: "feature", areas: ["board", "server"] })).toEqual({ add: ["feature", "board"], remove: [] })
  })

  it("changes nothing on a task that already matches, and only takes ui off a task the table doesn't list", () => {
    expect(planTask(["feature", "cli"], { kind: "feature", areas: ["cli"] })).toEqual({ add: [], remove: [] })
    expect(planTask(["ui", "server", "m3"], undefined)).toEqual({ add: [], remove: ["ui"] })
  })
})

const STATUSES = ["Backlog", "Todo", "In Progress", "Done"]

/**
 * A board in memory behind a fake \`cello\`: it answers the reads the script makes, applies its writes,
 * and records every call. \`fail\` makes a matching call fail as the CLI would.
 */
const fakeBoard = (
  init: {
    readonly labels: ReadonlyArray<{ readonly name: string; readonly color: string; readonly group?: string; readonly otherProjects?: number }>
    readonly tasks: ReadonlyArray<{ readonly key: string; readonly status: string; readonly labels: ReadonlyArray<string> }>
  },
  fail: (args: ReadonlyArray<string>) => string | null = () => null,
) => {
  let next = 0
  const labels = init.labels.map((l) => ({
    id: `l${++next}`,
    name: l.name,
    color: l.color,
    group: l.group ?? "none",
    archivedAt: null as number | null,
    otherProjects: l.otherProjects ?? 0,
  }))
  const find = (name: string) => labels.find((l) => l.name.toLowerCase() === name.toLowerCase())!
  const tasks = init.tasks.map((t) => ({ key: t.key, status: t.status, labelIds: t.labels.map((name) => find(name).id) }))
  const calls: string[][] = []
  const ok = (value: unknown) => ({ out: JSON.stringify(value), failure: null })
  const cli: Cli = async (args) => {
    calls.push([...args])
    const failure = fail(args)
    if (failure !== null) return { out: "", failure }
    const [noun, verb] = args
    const option = (flag: string) => args[args.indexOf(flag) + 1]!
    if (noun === "label" && verb === "list") {
      return ok({
        labels: labels.map(({ otherProjects, ...label }) => ({
          label,
          tasks: tasks.filter((t) => t.labelIds.includes(label.id)).length,
          otherProjects,
        })),
      })
    }
    if (noun === "context") return ok({ statuses: STATUSES.map((name) => ({ name })) })
    if (noun === "task" && verb === "list") return ok({ tasks: tasks.filter((t) => t.status === option("--status")) })
    const has = (flag: string) => args.includes(flag)
    if (noun === "label" && verb === "create") {
      labels.push({ id: `l${++next}`, name: args[2]!, color: option("--color"), group: has("--group") ? option("--group") : "none", archivedAt: null, otherProjects: 0 })
    } else if (noun === "label" && verb === "update") {
      const label = find(args[2]!)
      if (has("--color")) label.color = option("--color")
      if (has("--group")) label.group = option("--group")
    } else if (noun === "label" && verb === "archive") find(args[2]!).archivedAt = 1
    else if (noun === "task" && verb === "label") {
      const task = tasks.find((t) => t.key === args[2])!
      for (const change of args.slice(3)) {
        const id = find(change.slice(1)).id
        task.labelIds = change[0] === "+" ? [...task.labelIds, id] : task.labelIds.filter((l) => l !== id)
      }
    } else throw new Error(`unexpected call: cello ${args.join(" ")}`)
    return ok({})
  }
  const isRead = (c: ReadonlyArray<string>) => c[0] === "context" || (c[1] === "list" && (c[0] === "label" || c[0] === "task"))
  return { cli, calls, writes: () => calls.filter((c) => !isRead(c)) }
}

/** The board before CEL-56: ui, server and M2, four tasks. */
const before = (uiElsewhere = 0) => ({
  labels: [
    { name: "ui", color: "#3B82F6", otherProjects: uiElsewhere },
    { name: "server", color: "#22C55E" },
    { name: "M2", color: "#F59E0B" },
  ],
  tasks: [
    { key: "CEL-1", status: "Done", labels: ["ui"] },
    { key: "CEL-3", status: "Todo", labels: ["ui", "M2"] },
    { key: "CEL-4", status: "Backlog", labels: ["server"] },
    { key: "CEL-60", status: "Todo", labels: ["ui"] },
  ],
})

const CEL = { project: "CEL", dryRun: false }

describe("apply, with a fake cello", () => {
  it("puts a board labelled before CEL-52 in groups: kinds, areas, M2 and M3 as milestones; again, nothing (CEL-52)", async () => {
    const board = fakeBoard({
      labels: [...LABELS, { name: "M2", color: "#26B5CE" }, { name: "M3", color: "#26B5CE" }, { name: "someday", color: "#999999" }],
      tasks: [{ key: "CEL-3", status: "Todo", labels: ["feature", "cli"] }],
    })
    const lines = await apply(board.cli, CEL)
    expect(lines.slice(0, 3)).toEqual(["put label feature in kind", "put label bug in kind", "put label polish in kind"])
    expect(lines).toContain("put label board in area")
    expect(lines.slice(-2)).toEqual(["put label M2 in milestone", "put label M3 in milestone"])
    expect(board.writes()).toHaveLength(22)
    expect(board.writes()[0]).toEqual(["label", "update", "feature", "--group", "kind", "--project", "CEL"])
    expect(board.writes().some((c) => c.includes("someday"))).toBe(false)

    board.calls.length = 0
    expect(await apply(board.cli, CEL)).toEqual(["Nothing to change: CEL's labels already match the CEL-56 table."])
    expect(board.writes()).toEqual([])
  })

  it("--dry-run makes no write calls, and says the archive can't be undone", async () => {
    const board = fakeBoard(before())
    const lines = await apply(board.cli, { ...CEL, dryRun: true })
    expect(board.writes()).toEqual([])
    expect(lines).toContain("Would: CEL-3 +feature +cli -ui")
    expect(lines.at(-2)).toBe("Would: archive label ui (it can't be undone: there's no unarchive)")
  })

  it("archives ui last, after every task label, and a second run makes no writes", async () => {
    const board = fakeBoard(before())
    const lines = await apply(board.cli, CEL)
    const writes = board.writes()
    expect(writes.at(-1)).toEqual(["label", "archive", "ui", "--project", "CEL"])
    expect(writes.filter((c) => c[1] === "archive")).toHaveLength(1)
    expect(writes.map((c) => c.slice(0, 2).join(" ")).lastIndexOf("task label")).toBe(writes.length - 2)
    expect(writes.filter((c) => c[1] === "label").map((c) => c[2])).toEqual(["CEL-1", "CEL-3", "CEL-4", "CEL-60"])
    expect(lines).toContain("archived label ui (it can't be undone: there's no unarchive)")
    expect(lines.at(-1)).toBe("Not in the table, so without a kind: CEL-60. Label them with `cello task label`.")

    board.calls.length = 0
    expect(await apply(board.cli, CEL)).toEqual([
      "Nothing to change: CEL's labels already match the CEL-56 table.",
      "Not in the table, so without a kind: CEL-60. Label them with `cello task label`.",
    ])
    expect(board.writes()).toEqual([])
  })

  it("a failing call stops the run before the archive", async () => {
    const board = fakeBoard(before(), (args) => (args[1] === "label" && args[2] === "CEL-3" ? "It was changed by Lucas in the meantime." : null))
    await expect(apply(board.cli, CEL)).rejects.toThrow("cello task label CEL-3 +feature +cli -ui failed: It was changed by Lucas in the meantime.")
    expect(board.calls.some((c) => c[1] === "archive")).toBe(false)
    expect(board.calls.some((c) => c[2] === "CEL-4")).toBe(false)
  })

  it("leaves ui alone when other projects' tasks carry it, unless --archive-ui says go ahead, warning before the archive", async () => {
    const warning = "2 tasks in other projects of the workspace carry ui; archiving hides it on them too, and it can't be undone."

    const dry = fakeBoard(before(2))
    const planned = await apply(dry.cli, { ...CEL, dryRun: true })
    expect(planned).toContain(`Not archiving ui: ${warning} Run again with --archive-ui to archive it anyway.`)
    expect(planned.some((l) => l.startsWith("Would: archive"))).toBe(false)

    const held = fakeBoard(before(2))
    const lines = await apply(held.cli, CEL)
    expect(held.writes().some((c) => c[1] === "archive")).toBe(false)
    expect(lines).toContain(`Not archiving ui: ${warning} Run again with --archive-ui to archive it anyway.`)
    // The tasks in this project still lose ui.
    expect(held.writes().filter((c) => c[1] === "label").map((c) => c[2])).toEqual(["CEL-1", "CEL-3", "CEL-4", "CEL-60"])

    const forced = fakeBoard(before(2))
    const done = await apply(forced.cli, { ...CEL, archiveUi: true })
    expect(forced.writes().at(-1)).toEqual(["label", "archive", "ui", "--project", "CEL"])
    const at = done.indexOf(`Warning: ${warning}`)
    expect(at).toBeGreaterThan(-1)
    expect(done[at + 1]).toBe("archived label ui (it can't be undone: there's no unarchive)")
  })
})

/** A temp server with project CEL as it was before: labels ui, server and M2, and five tasks. */
const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port)
  const snapshot = yield* human["snapshot.get"]({})
  const workspaceId = snapshot.workspaces[0]!.id
  const status = Object.fromEntries(snapshot.statuses.map((s) => [s.name, s.id]))
  const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })
  const label = (name: string, color: string) =>
    human["label.create"]({ commandId: newCommandId(), workspaceId, name, color }).pipe(Effect.map((w) => w.result.id))
  const ui = yield* label("ui", "#3B82F6")
  const server = yield* label("server", "#22C55E")
  const m2 = yield* label("M2", "#F59E0B")
  const task = (title: string, statusId: string, labelIds: string[]) =>
    human["task.create"]({ commandId: newCommandId(), projectId: project.id, title, statusId, labelIds })
  yield* task("M0 spikes", status["Done"]!, [ui])
  yield* task("M1 local board", status["Done"]!, [server, m2])
  yield* task("cello CLI basics", status["Todo"]!, [ui])
  yield* task("Agent sessions", status["Backlog"]!, [server])
  yield* task("Provenance on cards", status["In Progress"]!, [])
  const env = { CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_PID: String(process.pid) }
  const cli = cello({ port, env, cwd: repo })
  return {
    human,
    port,
    repo,
    env,
    run: (dryRun = false) =>
      apply((args) => Effect.runPromise(cli(...args)), { project: "CEL", dryRun }),
  }
})

describe("apply-cel56-labels against a real server", () => {
  it.live("creates the labels, labels each task by the table, archives ui; a second run, as a real process, changes nothing", () =>
    Effect.gen(function* () {
      const { human, port, repo, env, run } = yield* setup

      // A dry run says what it would do and changes nothing.
      const seqBefore = (yield* human["snapshot.get"]({})).seq
      const planned = yield* Effect.promise(() => run(true))
      expect(planned).toContain("Would: CEL-3 +feature +cli -ui")
      expect((yield* human["snapshot.get"]({})).seq).toBe(seqBefore)

      const first = yield* Effect.promise(() => run())
      expect(first).toEqual([
        ...LABELS.map((l) => {
          const group = l.name in KIND_COLORS ? "kind" : "area"
          return l.name === "server" ? "recoloured label server #22C55E → #8D7B68 and put it in area" : `created label ${l.name} ${l.color} in ${group}`
        }),
        "put label M2 in milestone",
        "CEL-1 +chore +agents +board +server -ui",
        "CEL-2 +feature +board",
        "CEL-3 +feature +cli -ui",
        "CEL-4 +feature +agents",
        "CEL-5 +feature +agents +board +task-panel",
        "archived label ui (it can't be undone: there's no unarchive)",
      ])

      const snapshot = yield* human["snapshot.get"]({})
      const name = new Map(snapshot.labels.map((l) => [l.id, l.name]))
      const labelsOf = (key: string) => snapshot.tasks.find((t) => t.key === key)!.labelIds.map((id) => name.get(id)).sort()
      expect(labelsOf("CEL-1")).toEqual(["agents", "board", "chore", "server"])
      expect(labelsOf("CEL-2")).toEqual(["M2", "board", "feature", "server"])
      expect(labelsOf("CEL-3")).toEqual(["cli", "feature"])
      expect(labelsOf("CEL-4")).toEqual(["agents", "feature", "server"])
      expect(snapshot.labels.find((l) => l.name === "ui")!.archivedAt).not.toBeNull()
      expect(snapshot.labels.find((l) => l.name === "server")!.color).toBe("#8D7B68")
      expect(snapshot.labels.find((l) => l.name === "M2")!.color).toBe("#F59E0B")
      const groupOf = (name: string) => snapshot.labels.find((l) => l.name === name)!.group
      expect([groupOf("bug"), groupOf("server"), groupOf("cli"), groupOf("M2"), groupOf("ui")]).toEqual(["kind", "area", "area", "milestone", "none"])
      // Credited to the agent session that ran it.
      const relabel = (yield* human["task.history"]({ id: snapshot.tasks.find((t) => t.key === "CEL-3")!.id })).at(-1)!
      expect(relabel).toMatchObject({ type: "task.labels_changed" })
      expect(relabel.sessionId).not.toBeNull()

      // Again, the way the orchestrator runs it: a process running `cello` from source.
      const proc = Bun.spawn(["bun", SCRIPT, "--project", "CEL"], {
        cwd: repo,
        env: { PATH: process.env.PATH, HOME: TEST_HOME, CELLO_PORT: String(port), CELLO_CLI: `bun ${BIN}`, ...env },
        stdout: "pipe",
        stderr: "pipe",
      })
      const [code, out, err] = yield* Effect.promise(() =>
        Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
      )
      expect({ code, err }).toEqual({ code: 0, err: "" })
      expect(out.trim()).toBe("Nothing to change: CEL's labels already match the CEL-56 table.")
      expect((yield* human["snapshot.get"]({})).seq).toBe(snapshot.seq)
    }).pipe(Effect.scoped), { timeout: 60_000 })
})
