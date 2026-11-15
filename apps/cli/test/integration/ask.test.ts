// Needs input (CEL-47) against a real server: an agent asks with `cello task ask` (from a file or
// inline flags), the task moves to Needs input, Lucas answers through the RPC (with a screenshot he
// pasted, uploaded over HTTP), and the agent gets the answers: `--wait` returns, or the hook delivers
// them once, with the screenshots saved as files it can open. Withdrawing, and Lucas moving the card
// himself, take the ask back. An existing board gets the Needs input column when the server upgrades.
import * as fs from "node:fs"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import type { Ask } from "@cello/contract/entities"
import { DB_FILE } from "@cello/server/server/ServerLock"
import { writeBoardBeforeAsks } from "@cello/server/testing/boardBeforeAsks"
import { writePng } from "@cello/server/testing/media"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import * as Fiber from "effect/Fiber"
import * as Stream from "effect/Stream"
import { connect } from "../../../server/test/integration/harness.ts"
import { WAIT_NUDGE } from "../../src/claudeHook.ts"
import { cello, gitRepo } from "./cli.ts"

const X = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const claude = (session: string) => ({ CLAUDE_CODE_SESSION_ID: session, CLAUDE_PID: String(process.pid) })

/** Project CEL linked to a git repo; session X created CEL-1 and claimed it. Two screenshots in the repo. */
const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port)
  const snapshot = yield* human["snapshot.get"]({})
  const workspaceId = snapshot.workspaces[0]!.id
  const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })
  const x = cello({ port, env: claude(X), cwd: repo })
  yield* x("task", "create", "Search layout")
  yield* x("task", "claim", "CEL-1")
  fs.mkdirSync(path.join(repo, "shots"))
  writePng(path.join(repo, "shots"), "peek.png")
  writePng(path.join(repo, "shots"), "palette.png")
  /** The next ask.created on the board: awaited, never polled for. */
  const nextAsk = Effect.gen(function* () {
    const { seq } = yield* human["snapshot.get"]({ scope: { projectId: project.id } })
    return yield* Effect.forkChild(human["events.subscribe"]({ scope: { projectId: project.id }, afterSeq: seq }).pipe(
      Stream.filter((e) => e.type === "ask.created"),
      Stream.runHead,
      Effect.map((e) => (e._tag === "Some" && e.value.type === "ask.created" ? e.value.ask : null)!),
    ))
  })
  return {
    port,
    repo,
    human,
    x,
    nextAsk,
    statusId: (name: string) => snapshot.statuses.find((s) => s.name === name)!.id,
    hook: (event: string) => cello({ port, env: {}, cwd: repo, stdin: JSON.stringify({ session_id: X, cwd: repo }) })("hook", "claude", event),
  }
})

const ASK_FILE = {
  title: "Search layout",
  intro: "Both are built; screenshots below.",
  questions: [
    {
      prompt: "Which layout?",
      options: [
        { label: "Peek", description: "List + preview", image: "shots/peek.png", recommended: true, because: "Most results are long text" },
        { label: "Palette", image: "shots/palette.png" },
      ],
    },
    { prompt: "Anything else?" },
  ],
  links: ["http://127.0.0.1:4747/CEL/pages/cel-43-scope"],
}

/** Lucas pastes a screenshot into a draft: the browser posts it to the server. */
const paste = (port: number, askId: string, bytes: Uint8Array, name = "image.png") =>
  Effect.promise(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/asks/${askId}/uploads?name=${name}`, { method: "POST", body: new Blob([bytes as Uint8Array<ArrayBuffer>]) })
    return { status: response.status, body: await response.json() as { id: string; reason?: string } }
  })

const answer = (ask: Ask, screenshot?: string) => ({
  commandId: newCommandId(),
  askId: ask.id,
  answers: [
    { questionId: "q1", optionIds: ["q1o1"], comment: "Go with Peek, narrower preview", ...(screenshot ? { attachmentIds: [screenshot] } : {}) },
    { questionId: "q2", optionIds: [], comment: "Ship it after the e2e passes" },
  ],
  note: "Thanks!",
})

describe("cello task ask", () => {
  it.live("--file asks on the card: the task moves to Needs input, with the evidence; `task get` lists the questions", () =>
    Effect.gen(function* () {
      const { x, repo, port } = yield* setup
      fs.writeFileSync(path.join(repo, "ask.json"), JSON.stringify(ASK_FILE))
      expect(yield* x("task", "ask", "CEL-1", "--file", "ask.json")).toEqual({
        out: [
          "Asked Lucas on CEL-1: \"Search layout\" (2 questions)  In Progress → Needs input",
          `  Lucas answers at http://127.0.0.1:${port}/review?open=CEL-1`,
          "  The answers reach this session through the hook, or run `cello wait CEL-1`.",
        ].join("\n"),
        failure: null,
      })
      const detail = JSON.parse((yield* x("task", "get", "CEL-1", "--json")).out)
      expect(detail.statuses.find((s: { id: string }) => s.id === detail.task.statusId).name).toBe("Needs input")
      const [ask] = detail.asks as Ask[]
      expect(ask!.attachments.map((a) => a.name)).toEqual(["peek.png", "palette.png", "http://127.0.0.1:4747/CEL/pages/cel-43-scope"])
      expect(ask!.questions[0]!.options.map((o) => o.imageId)).toEqual([ask!.attachments[0]!.id, ask!.attachments[1]!.id])
      const text = (yield* x("task", "get", "CEL-1")).out
      expect(text).toContain("Questions for Lucas (1)\n  Round 1 · open: \"Search layout\", asked by Claude Code session 2fd0505c, just now\n    1. Which layout?\n    2. Anything else?")
    }).pipe(Effect.scoped))

  it.live("inline flags ask one question; mistakes are explained", () =>
    Effect.gen(function* () {
      const { x } = yield* setup
      expect((yield* x("task", "ask", "CEL-1", "--question", "Which?", "--option", "A")).failure).toBe("Give the ask a --title (or a title: in the file).")
      expect((yield* x("task", "ask", "CEL-1", "--title", "Layout", "--question", "Which?", "--option", "A", "--recommend", "A")).failure)
        .toBe("Say why you recommend \"A\" (because).")
      const asked = yield* x(
        "task", "ask", "CEL-1", "--title", "Layout", "--question", "Which layout?",
        "--option", "Peek|List + preview", "--recommend", "Peek", "--because", "Long results",
        "--option", "Palette", "--attach", "shots/peek.png", "--caption", "Peek, dark", "--json",
      )
      const { result } = JSON.parse(asked.out) as { result: { ask: Ask } }
      expect(result.ask.questions).toMatchObject([{
        prompt: "Which layout?",
        kind: "one",
        options: [{ label: "Peek", description: "List + preview", recommended: true, because: "Long results" }, { label: "Palette" }],
      }])
      expect(result.ask.attachments).toMatchObject([{ name: "peek.png", caption: "Peek, dark" }])
    }).pipe(Effect.scoped))

  it.live("--wait returns when Lucas answers through the RPC, with the screenshot he pasted saved as a file", () =>
    Effect.gen(function* () {
      const { x, human, port, nextAsk, repo } = yield* setup
      fs.writeFileSync(path.join(repo, "ask.json"), JSON.stringify(ASK_FILE))
      const created = yield* nextAsk
      const waiting = yield* Effect.forkChild(x("task", "ask", "CEL-1", "--file", "ask.json", "--wait"))
      const ask = yield* Fiber.join(created)

      const pasted = new Uint8Array(fs.readFileSync(writePng(repo, "pasted.png")))
      const upload = yield* paste(port, ask.id, pasted)
      expect(upload.status).toBe(201)
      yield* human["ask.answer"](answer(ask, upload.body.id))

      const { out, failure } = yield* Fiber.join(waiting)
      expect(failure).toBeNull()
      const lines = out.split("\n")
      expect(lines.slice(0, 4)).toEqual([
        "Asked Lucas on CEL-1: \"Search layout\" (2 questions)  In Progress → Needs input",
        `  Lucas answers at http://127.0.0.1:${port}/review?open=CEL-1`,
        "  Waiting for the answers…",
        "Lucas answered \"Search layout\" on CEL-1, just now:",
      ])
      const saved = lines.find((l) => l.includes("Screenshot: "))!.split("Screenshot: ")[1]!
      expect(new Uint8Array(fs.readFileSync(saved))).toEqual(pasted)
      expect(out).toContain([
        "1. Which layout?",
        "   Picked: Peek (your recommendation)",
        "   Comment: Go with Peek, narrower preview",
        `   Screenshot: ${saved}`,
        "",
        "2. Anything else?",
        "   Comment: Ship it after the e2e passes",
        "",
        "Note: Thanks!",
      ].join("\n"))

      // The task is back in progress with the claim, and the hook has nothing left to deliver.
      const detail = JSON.parse((yield* x("task", "get", "CEL-1", "--json")).out)
      expect(detail.statuses.find((s: { id: string }) => s.id === detail.task.statusId).name).toBe("In Progress")
      expect(detail.task.assigneeSessionId).not.toBeNull()
      expect((yield* x("inbox", "--new")).out).toBe("")
      // `cello task answers` prints them again.
      expect((yield* x("task", "answers", "CEL-1")).out).toContain("   Picked: Peek (your recommendation)")
    }).pipe(Effect.scoped))

  it.live("without --wait, the hook delivers the answers once, screenshots as files", () =>
    Effect.gen(function* () {
      const { x, human, port, repo, hook } = yield* setup
      fs.writeFileSync(path.join(repo, "ask.json"), JSON.stringify(ASK_FILE))
      const { result } = JSON.parse((yield* x("task", "ask", "CEL-1", "--file", "ask.json", "--json")).out) as { result: { ask: Ask } }
      const upload = yield* paste(port, result.ask.id, new Uint8Array(fs.readFileSync(writePng(repo, "pasted.png"))))
      yield* human["ask.answer"](answer(result.ask, upload.body.id))

      const delivered = yield* hook("stop")
      const context = JSON.parse(delivered.out).hookSpecificOutput.additionalContext as string
      expect(context.split("\n").slice(0, 5)).toEqual([
        "New in Cello for you: answers to the questions you asked:",
        "",
        "CEL-1  Search layout",
        "  Lucas answered your questions \"Search layout\", just now",
        "    1. Which layout?",
      ])
      const saved = context.split("\n").find((l) => l.includes("Screenshot: "))!.split("Screenshot: ")[1]!
      expect(fs.existsSync(saved)).toBe(true)
      expect(yield* hook("post-tool-use")).toEqual({ out: "", failure: null })
      // Not again: the stop only asks for a waiter, since the session still holds CEL-1 (CEL-74).
      expect(JSON.parse((yield* hook("stop")).out).hookSpecificOutput.additionalContext).toBe(WAIT_NUDGE(["CEL-1"]))
    }).pipe(Effect.scoped))

  it.live("--withdraw takes the ask back; a waiting agent hears it was withdrawn", () =>
    Effect.gen(function* () {
      const { x, nextAsk, repo } = yield* setup
      fs.writeFileSync(path.join(repo, "ask.json"), JSON.stringify(ASK_FILE))
      const created = yield* nextAsk
      yield* x("task", "ask", "CEL-1", "--file", "ask.json")
      yield* Fiber.join(created)
      const waiting = yield* Effect.forkChild(x("wait", "CEL-1"))
      expect(yield* x("task", "ask", "CEL-1", "--withdraw")).toEqual({
        out: "Withdrew the questions on CEL-1 (\"Search layout\"); it's back in progress.",
        failure: null,
      })
      expect((yield* Fiber.join(waiting)).out).toMatch(/^CEL-1's questions "Search layout" were withdrawn (just now|\d+m ago); there are no answers\.$/)
      expect((yield* x("task", "ask", "CEL-1", "--withdraw")).failure).toBe("CEL-1 has no open ask to withdraw.")
    }).pipe(Effect.scoped))

  it.live("Lucas moving the card out of Needs input withdraws the ask; an agent can't move a task into it by hand", () =>
    Effect.gen(function* () {
      const { x, human, repo, statusId, hook } = yield* setup
      expect((yield* x("task", "move", "CEL-1", "Needs input")).failure).toBe(
        "CEL-1 goes to Needs input only with questions for Lucas. Ask them instead: " +
          "`cello task ask CEL-1 --title \"what to decide\" --question \"…\" --option \"A\" --option \"B\"` (or --file ask.json). See `cello guide`.",
      )
      fs.writeFileSync(path.join(repo, "ask.json"), JSON.stringify(ASK_FILE))
      yield* x("task", "ask", "CEL-1", "--file", "ask.json")
      const { task } = JSON.parse((yield* x("task", "get", "CEL-1", "--json")).out)
      yield* human["task.move"]({ commandId: newCommandId(), id: task.id, statusId: statusId("Todo") })
      // The session that asked hears it, once.
      const context = JSON.parse((yield* hook("stop")).out).hookSpecificOutput.additionalContext as string
      expect(context).toContain("CEL-1  Search layout\n  Lucas moved it out of Needs input, just now\n    Lucas moved CEL-1 to Todo; your ask \"Search layout\" was withdrawn.")
      expect(yield* hook("stop")).toEqual({ out: "", failure: null })
      expect((yield* x("task", "answers", "CEL-1")).out).toMatch(/^CEL-1's questions "Search layout" were withdrawn/)
      // The claim ended, as with any move Lucas makes; the questions stay in the task's history.
      expect((yield* x("context")).out).toContain("CEL-1  ended when Lucas changed it")
      expect((yield* x("task", "get", "CEL-1")).out).toContain("Round 1 · withdrawn just now: \"Search layout\"")
    }).pipe(Effect.scoped))

  it.live("rounds: a follow-up after Lucas's answers; `task answers` prints the latest, --all every round", () =>
    Effect.gen(function* () {
      const { x, human, repo } = yield* setup
      fs.writeFileSync(path.join(repo, "ask.json"), JSON.stringify(ASK_FILE))
      const first = JSON.parse((yield* x("task", "ask", "CEL-1", "--file", "ask.json", "--json")).out).result.ask as Ask
      yield* human["ask.answer"]({
        commandId: newCommandId(),
        askId: first.id,
        answers: [
          { questionId: "q1", optionIds: ["q1o1", "q1o2"], comment: "Both, behind a toggle" },
          { questionId: "q2", optionIds: [], comment: "Ship it" },
        ],
      })
      yield* x("task", "ask", "CEL-1", "--title", "The toggle", "--question", "Where does the toggle go?", "--option", "Header", "--option", "Footer")
      const latest = (yield* x("task", "answers", "CEL-1")).out
      expect(latest.split("\n").slice(0, 2)).toEqual(["Round 1 · answered", "Lucas answered \"Search layout\" on CEL-1, just now:"])
      expect(latest).toContain("   Picked: Peek (your recommendation), Palette")
      expect(latest).toContain("Round 2 · open: \"The toggle\" is still open; `cello wait CEL-1` waits for the answers.")
      const all = (yield* x("task", "answers", "CEL-1", "--all")).out
      expect(all).toContain("Round 1 · answered: \"Search layout\", asked just now\n  1. Which layout?\n     Picked: Peek (your recommendation), Palette")
      expect(all).toContain("Round 2 · open: \"The toggle\", asked just now\n  1. Where does the toggle go?")
    }).pipe(Effect.scoped))

  it.live("an agent can't paste screenshots into answers", () =>
    Effect.gen(function* () {
      const { x, port, repo } = yield* setup
      fs.writeFileSync(path.join(repo, "ask.json"), JSON.stringify(ASK_FILE))
      const { result } = JSON.parse((yield* x("task", "ask", "CEL-1", "--file", "ask.json", "--json")).out) as { result: { ask: Ask } }
      const response = yield* Effect.promise(() =>
        fetch(`http://127.0.0.1:${port}/asks/${result.ask.id}/uploads?name=a.png`, { method: "POST", body: new Uint8Array([1]), headers: { "x-cello-session": X } })
      )
      expect(response.status).toBe(403)
      expect((yield* paste(port, result.ask.id, new Uint8Array([1]), "page.html")).status).toBe(400)
      expect((yield* paste(port, "nope", new Uint8Array([1]))).status).toBe(404)
    }).pipe(Effect.scoped))
})

describe("upgrading an existing board", () => {
  it.live("the server adds Needs input between In Progress and In Review, and keeps every task where it was", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      // A board made before CEL-47, with a task in each of In Progress, In Review and Done.
      yield* writeBoardBeforeAsks(path.join(dataDir, DB_FILE))

      const { port } = yield* startServer(dataDir)
      const me = cello({ port, env: { CELLO_SESSION: "me" }, cwd: dataDir })
      expect((yield* me("context", "--project", "CEL")).out).toContain("Statuses  Todo · In Progress · Needs input · In Review · Done")
      expect((yield* me("task", "list", "--project", "CEL")).out.split("\n")).toEqual(["CEL-1  In Progress  Task 1", "CEL-2  In Review    Task 2"])
      expect((yield* me("task", "list", "--project", "CEL", "--status", "Done")).out).toBe("CEL-3  Done  Task 3")
    }).pipe(Effect.scoped))
})
