// Which model wrote an agent's last reply (CEL-119), from the end of its Claude Code transcript: the
// session's own, or a subagent's under `<session>/subagents/`. Only the tail is read, and only again when
// the file changed; a transcript Cello doesn't read, or one with no reply yet, says nothing.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { lastModel, modelReader } from "./transcriptModel.ts"

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, "fixtures", name), "utf8")
const linesOf = (text: string) => text.split("\n").filter((l) => l !== "")

/** An assistant line as Claude Code writes it: the model on the message, the effort beside it. */
const reply = (model: string, effort?: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "assistant", uuid: crypto.randomUUID(), ...(effort ? { effort } : {}), ...extra, message: { model, role: "assistant", content: [{ type: "text", text: "ok" }] } })

describe("lastModel", () => {
  it("reads the model and effort of a main session's last reply", () => {
    expect(lastModel(linesOf(fixture("model-session.jsonl")))).toEqual({ model: "claude-opus-5-5", effort: "high" })
  })

  it("reads a subagent's own model from its transcript, not the model its launch asked for", () => {
    expect(lastModel(linesOf(fixture("model-session/subagents/agent-a31a1df3768ec77df.jsonl")))).toEqual({ model: "claude-haiku-5-5", effort: "medium" })
  })

  it("takes the newest reply: a /model switch shows from the next reply on", () => {
    expect(lastModel([reply("claude-opus-5-5", "high"), reply("claude-sonnet-5-5", "medium")])).toEqual({ model: "claude-sonnet-5-5", effort: "medium" })
  })

  it("skips Claude Code's own synthetic replies, lines that aren't JSON and lines that aren't replies", () => {
    expect(lastModel([
      reply("claude-opus-5-5", "high"),
      reply("<synthetic>"),
      "{not json",
      JSON.stringify({ type: "user", message: { model: "claude-haiku-5-5", content: "hi" } }),
    ])).toEqual({ model: "claude-opus-5-5", effort: "high" })
  })

  it("keeps a reply without an effort, and drops an effort or a model that isn't a plain word", () => {
    expect(lastModel([reply("claude-opus-5-5")])).toEqual({ model: "claude-opus-5-5", effort: null })
    expect(lastModel([reply("claude-opus-5-5", "very\u0007high")])).toEqual({ model: "claude-opus-5-5", effort: null })
    expect(lastModel([reply("claude-opus-5-5", "high"), reply("claude\nopus"), reply("x".repeat(200))])).toEqual({ model: "claude-opus-5-5", effort: "high" })
  })

  it("is nothing before the first reply", () => {
    expect(lastModel([])).toBeNull()
    expect(lastModel(linesOf(fixture("model-session.jsonl")).slice(0, 2))).toBeNull()
  })
})

describe("modelReader", () => {
  let root: string
  let projects: string
  let file: string
  let opened: number
  const counting = {
    statSync: (f: string) => fs.statSync(f),
    openSync: (f: string, flags: "r") => {
      opened++
      return fs.openSync(f, flags)
    },
    readSync: (fd: number, buffer: Buffer, offset: number, length: number, position: number) => fs.readSync(fd, buffer, offset, length, position),
    closeSync: (fd: number) => fs.closeSync(fd),
  }

  beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cel119-model-")))
    projects = path.join(root, "claude", "projects")
    fs.mkdirSync(path.join(projects, "-work-pancakes", "s1", "subagents"), { recursive: true })
    file = path.join(projects, "-work-pancakes", "s1.jsonl")
    fs.writeFileSync(file, fixture("model-session.jsonl"))
    opened = 0
  })

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

  it("reads a session's and a subagent's transcript inside projects/", () => {
    const sub = path.join(projects, "-work-pancakes", "s1", "subagents", "agent-a31a1df3768ec77df.jsonl")
    fs.writeFileSync(sub, fixture("model-session/subagents/agent-a31a1df3768ec77df.jsonl"))
    const read = modelReader({ projectsDir: projects })
    expect(read(file)).toEqual({ model: "claude-opus-5-5", effort: "high" })
    expect(read(sub)).toEqual({ model: "claude-haiku-5-5", effort: "medium" })
  })

  it("reads the file again only once it changed, and then sees the new model", () => {
    const read = modelReader({ projectsDir: projects, io: counting })
    expect(read(file)?.model).toBe("claude-opus-5-5")
    const first = opened
    expect(read(file)?.model).toBe("claude-opus-5-5")
    expect(opened).toBe(first)
    fs.appendFileSync(file, `${reply("claude-sonnet-5-5", "medium")}\n`)
    expect(read(file)).toEqual({ model: "claude-sonnet-5-5", effort: "medium" })
    expect(opened).toBeGreaterThan(first)
  })

  it("reads only the end of the file: a reply further back than its largest window isn't found", () => {
    const big = "x".repeat(5000)
    fs.writeFileSync(file, `${reply("claude-opus-5-5", "high")}\n${JSON.stringify({ type: "user", message: { content: big } })}\n`)
    expect(modelReader({ projectsDir: projects, windows: [1024, 2048] })(file)).toBeNull()
    // A larger second window reaches it after the first one came up empty.
    expect(modelReader({ projectsDir: projects, windows: [1024, 8192] })(file)).toEqual({ model: "claude-opus-5-5", effort: "high" })
  })

  it("says nothing for a transcript outside projects/, one that's gone, or one with no reply yet", () => {
    const outside = path.join(root, "elsewhere.jsonl")
    fs.writeFileSync(outside, `${reply("claude-opus-5-5", "high")}\n`)
    const read = modelReader({ projectsDir: projects })
    expect(read(outside)).toBeNull()
    expect(read(path.join(projects, "-work-pancakes", "gone.jsonl"))).toBeNull()
    fs.writeFileSync(file, `${JSON.stringify({ type: "user", message: { content: "hi" } })}\n`)
    expect(read(file)).toBeNull()
  })
})
