// CEL-56's apply script: the table is well formed, each task's plan is right, and against a real
// server it creates the labels, labels the tasks, archives ui, and a second run changes nothing.
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { apply, AREA_GROUPS, KIND_COLORS, LABELS, planTask, TABLE } from "../../../../scripts/apply-cel56-labels.ts"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo, TEST_HOME } from "./cli.ts"

const SCRIPT = path.resolve(import.meta.dirname, "../../../../scripts/apply-cel56-labels.ts")
const BIN = path.resolve(import.meta.dirname, "../../src/bin.ts")
const SESSION = "2fd0505c-417a-4167-acfe-2d66080fcae0"

describe("the CEL-56 table", () => {
  it("gives every task from CEL-1 to CEL-57 but canceled CEL-40 one kind and at least one known area", () => {
    const areas = new Set<string>(Object.values(AREA_GROUPS).flatMap((g) => g.areas))
    const keys = Object.keys(TABLE)
    expect(keys).toEqual(Array.from({ length: 57 }, (_, i) => `CEL-${i + 1}`).filter((k) => k !== "CEL-40"))
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
        ...LABELS.map((l) => l.name === "server" ? "recoloured label server #22C55E → #8D7B68" : `created label ${l.name} ${l.color}`),
        "CEL-1 +chore +agents +board +server -ui",
        "CEL-2 +feature +board",
        "CEL-3 +feature +cli -ui",
        "CEL-4 +feature +agents",
        "CEL-5 +feature +agents +board +task-panel",
        "archived label ui",
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
