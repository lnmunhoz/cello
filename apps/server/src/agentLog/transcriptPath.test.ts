// The guard on transcript paths (CEL-106): Cello reads a file a hook reported only when it's a .jsonl
// inside Claude Code's projects/ folder, with symlinks resolved.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { claudeProjectsDir, guardLogFile } from "./transcriptPath.ts"

let root: string
let projects: string
let outside: string

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cel106-guard-")))
  projects = path.join(root, "claude", "projects")
  outside = path.join(root, "elsewhere")
  fs.mkdirSync(path.join(projects, "-work-pancakes", "s1", "subagents"), { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(projects, "-work-pancakes", "s1.jsonl"), "{}\n")
  fs.writeFileSync(path.join(projects, "-work-pancakes", "s1", "subagents", "agent-a1.jsonl"), "{}\n")
  fs.writeFileSync(path.join(outside, "secret.jsonl"), "{}\n")
})

afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe("guardLogFile", () => {
  it("lets a session's and a subagent's transcript inside projects/ through, as their real paths", () => {
    expect(guardLogFile(path.join(projects, "-work-pancakes", "s1.jsonl"), projects)).toEqual({
      _tag: "ok",
      file: path.join(projects, "-work-pancakes", "s1.jsonl"),
    })
    expect(guardLogFile(path.join(projects, "-work-pancakes", "s1", "subagents", "agent-a1.jsonl"), projects)._tag).toBe("ok")
  })

  it("says missing for a file inside projects/ that isn't on disk (cleaned up, or not written yet)", () => {
    expect(guardLogFile(path.join(projects, "-work-pancakes", "gone.jsonl"), projects)).toEqual({ _tag: "missing" })
    expect(guardLogFile(path.join(projects, "-work-pancakes", "s2", "subagents", "agent-b2.jsonl"), projects)).toEqual({ _tag: "missing" })
  })

  it("refuses a path that climbs out with ..", () => {
    expect(guardLogFile(path.join(projects, "..", "..", "elsewhere", "secret.jsonl"), projects)).toEqual({ _tag: "refused" })
    expect(guardLogFile(`${projects}/../../elsewhere/secret.jsonl`, projects)).toEqual({ _tag: "refused" })
  })

  it("refuses a symlink inside projects/ that points outside, and a folder symlinked out", () => {
    fs.symlinkSync(path.join(outside, "secret.jsonl"), path.join(projects, "-work-pancakes", "link.jsonl"))
    expect(guardLogFile(path.join(projects, "-work-pancakes", "link.jsonl"), projects)).toEqual({ _tag: "refused" })
    fs.symlinkSync(outside, path.join(projects, "-out"))
    expect(guardLogFile(path.join(projects, "-out", "secret.jsonl"), projects)).toEqual({ _tag: "refused" })
    // Even when the file it would point at isn't there.
    expect(guardLogFile(path.join(projects, "-out", "none.jsonl"), projects)).toEqual({ _tag: "refused" })
  })

  it("refuses files elsewhere, relative paths, other kinds of file and projects/ itself", () => {
    expect(guardLogFile(path.join(outside, "secret.jsonl"), projects)).toEqual({ _tag: "refused" })
    expect(guardLogFile("-work-pancakes/s1.jsonl", projects)).toEqual({ _tag: "refused" })
    fs.writeFileSync(path.join(projects, "-work-pancakes", "notes.txt"), "x")
    expect(guardLogFile(path.join(projects, "-work-pancakes", "notes.txt"), projects)).toEqual({ _tag: "refused" })
    expect(guardLogFile(projects, projects)).toEqual({ _tag: "refused" })
  })

  it("says missing for everything when there's no Claude Code folder at all", () => {
    const none = path.join(root, "no-claude", "projects")
    expect(guardLogFile(path.join(none, "-work-pancakes", "s1.jsonl"), none)).toEqual({ _tag: "missing" })
  })
})

describe("claudeProjectsDir", () => {
  it("is CLAUDE_CONFIG_DIR's projects/, else ~/.claude/projects", () => {
    expect(claudeProjectsDir({ CLAUDE_CONFIG_DIR: "/tmp/claude-x" }, "/home/u")).toBe("/tmp/claude-x/projects")
    expect(claudeProjectsDir({}, "/home/u")).toBe("/home/u/.claude/projects")
  })
})
