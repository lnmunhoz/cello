// The Claude Code plugin (CEL-64): its files live in apps/cli/claude-plugin/ and travel inside the
// binary through the generated claudePluginFiles.ts, which can't drift from them. `cello install
// claude` writes them to a folder of Cello's own (XDG_DATA_HOME, else ~/.local/share), rewriting only
// what changed and only ever removing files it wrote there itself.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { APP_VERSION } from "@cello/shared/version"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CLAUDE_PLUGIN_FILES, OWN_FILES, pluginFolder, writePluginFolder } from "./claudePlugin.ts"
import { PLUGIN_FILES_MODULE, PLUGIN_SOURCE_DIR, pluginFilesModule, readPluginSource } from "./claudePluginSource.ts"

describe("the embedded plugin", () => {
  it("is exactly apps/cli/claude-plugin/ on disk: every file, nothing more (run `bun run docs:cli` after editing it)", () => {
    const onDisk = readPluginSource(PLUGIN_SOURCE_DIR)
    expect(CLAUDE_PLUGIN_FILES).toEqual(onDisk)
    expect(fs.readFileSync(PLUGIN_FILES_MODULE, "utf8")).toBe(pluginFilesModule(onDisk))
  })

  it("is a marketplace named cello holding one plugin named cello, at Cello's version", () => {
    const text = (p: string) => CLAUDE_PLUGIN_FILES.find((f) => f.path === p)?.text ?? ""
    const marketplace = JSON.parse(text(".claude-plugin/marketplace.json"))
    expect(marketplace.name).toBe("cello")
    expect(marketplace.plugins).toEqual([expect.objectContaining({ name: "cello", source: "./cello" })])
    const plugin = JSON.parse(text("cello/.claude-plugin/plugin.json"))
    expect(plugin).toMatchObject({ name: "cello", version: APP_VERSION })
    expect(CLAUDE_PLUGIN_FILES.map((f) => f.path)).toEqual(expect.arrayContaining([
      "cello/commands/orchestrate.md",
      "cello/skills/cello/SKILL.md",
      "cello/agents/builder.md",
      "cello/agents/reviewer.md",
    ]))
  })

  it("the module lists files in a stable order and keeps their text byte for byte", () => {
    const files = [{ path: "b.md", text: "two `ticks` and ${not} a template\n" }, { path: "a/x.json", text: "{}" }]
    const module = pluginFilesModule(files)
    expect(module).toContain(JSON.stringify("two `ticks` and ${not} a template\n"))
    expect(module.indexOf("\"a/x.json\"")).toBeLessThan(module.indexOf("\"b.md\""))
  })
})

// The project's lifecycle lives in its own LIFECYCLE.md (CEL-168): which steps, which agents, where they
// work and how work lands differ per project (Cello merges branches from worktrees; ThaiLookup commits
// to develop in the main checkout). The plugin keeps only the board mechanics every project shares.
describe("the plugin follows the project's LIFECYCLE.md (CEL-168)", () => {
  const text = (p: string) => CLAUDE_PLUGIN_FILES.find((f) => f.path === p)?.text ?? ""
  const orchestrate = text("cello/commands/orchestrate.md")
  const REPO_ROOT = path.join(import.meta.dirname, "../../..")
  const workflows = (doc: string) =>
    doc.split(/^### /m).slice(1).map((part) => ({ name: part.split("\n")[0]!.trim(), body: part.split(/^## /m)[0]! }))
  const templateHeadings = () => {
    const template = /````markdown\n([\s\S]*?)\n````/.exec(orchestrate)?.[1] ?? ""
    return template.split("\n").filter((line) => line.startsWith("## "))
  }

  it("orchestrate reads LIFECYCLE.md before it runs a task, and hard-codes no project's flow", () => {
    expect(orchestrate.indexOf("LIFECYCLE.md")).toBeGreaterThan(-1)
    expect(orchestrate.indexOf("LIFECYCLE.md")).toBeLessThan(orchestrate.indexOf("cello task claim"))
    for (const projectStep of ["commit on its branch", "in its own worktree", "Give it the task's text, the branch and its worktree"]) {
      expect(orchestrate, projectStep).not.toContain(projectStep)
    }
    // A worktree is only how LIFECYCLE.md's "Where agents work" is honoured, never the default.
    const worktreeLines = orchestrate.split("\n").filter((line) => line.includes('isolation: "worktree"'))
    expect(worktreeLines.length).toBeGreaterThan(0)
    for (const line of worktreeLines) expect(line).toContain("Where agents work")
  })

  it("orchestrate keeps the board mechanics every project shares", () => {
    for (const mechanic of ["cello sessions orchestrate on", "cello task claim", "cello task stage", "cello task ask", "cello inbox --wait", "cello task submit", "cello task done", "Merge after approval"]) {
      expect(orchestrate, mechanic).toContain(mechanic)
    }
  })

  it("without a LIFECYCLE.md, orchestrate drafts one from the repo, asks on the card, and writes it before running tasks", () => {
    const missing = orchestrate.slice(orchestrate.indexOf("## No LIFECYCLE.md yet"))
    expect(missing.startsWith("## No LIFECYCLE.md yet")).toBe(true)
    for (const step of ["AGENTS.md", ".claude/agents/", "cello context", "cello task ask", "Write"]) expect(missing, step).toContain(step)
  })

  it("ships a template whose sections cover a lifecycle: workflows, agents, where they work, how work lands, after it lands, releases", () => {
    expect(templateHeadings()).toEqual(["## Workflows", "## Agents", "## Where agents work", "## How work lands", "## After it lands", "## Releases"])
  })

  // Lucas: "different types of workflows inside that ... the orchestrator agent can dictate which one to
  // use for each feature, for each kind of specific task".
  it("LIFECYCLE.md lists named workflows, each saying when to use it; the template shows several", () => {
    const template = /````markdown\n([\s\S]*?)\n````/.exec(orchestrate)?.[1] ?? ""
    expect(workflows(template).length).toBeGreaterThan(1)
    for (const workflow of workflows(template)) expect(workflow.body, workflow.name).toMatch(/^Use it when: /m)
  })

  it("orchestrate picks one workflow per task, says which and why on the card, takes a change from the person, and asks when none fits", () => {
    const pick = orchestrate.slice(orchestrate.indexOf("**Pick each task's workflow**"), orchestrate.indexOf("Plan the order"))
    for (const part of ["Use it when", "cello task comment", "because", "change it", "None fits", "cello task ask"]) expect(pick, part).toContain(part)
    // Picked at the start, before the first step runs.
    expect(orchestrate.indexOf("**Pick each task's workflow**")).toBeLessThan(orchestrate.indexOf("## Each task, step by step"))
  })

  it("Cello's own LIFECYCLE.md has every section of the template, and AGENTS.md points to it instead of holding the flow", () => {
    const lifecycle = fs.readFileSync(path.join(REPO_ROOT, "LIFECYCLE.md"), "utf8")
    for (const heading of templateHeadings()) expect(lifecycle, heading).toContain(`\n${heading}\n`)
    // Today's flow is `feature`; AGENTS.md's "small changes skip steps 1-4" is a workflow of its own.
    expect(workflows(lifecycle).map((w) => w.name)).toEqual(["feature", "small"])
    for (const workflow of workflows(lifecycle)) expect(workflow.body, workflow.name).toMatch(/^Use it when: /m)
    const agents = fs.readFileSync(path.join(REPO_ROOT, "AGENTS.md"), "utf8")
    expect(agents).toContain("LIFECYCLE.md")
    expect(agents).not.toContain("## How a task flows")
  })

  it("the builder and reviewer agents assume no worktree or branch: the brief and LIFECYCLE.md say where they work", () => {
    const builder = text("cello/agents/builder.md")
    const reviewer = text("cello/agents/reviewer.md")
    expect(builder).not.toMatch(/^isolation:/m)
    for (const agent of [builder, reviewer]) {
      expect(agent).toContain("LIFECYCLE.md")
      // Both ways a project keeps work, not one of them assumed.
      expect(agent).toMatch(/worktree/)
      expect(agent).toMatch(/main checkout|checkout shared with other sessions/)
    }
    expect(reviewer).toMatch(/working-tree diff/)
  })

  it("/cello:work is gone, and nothing the plugin ships points to it", () => {
    expect(CLAUDE_PLUGIN_FILES.map((f) => f.path)).not.toContain("cello/commands/work.md")
    for (const file of CLAUDE_PLUGIN_FILES) expect(file.text, file.path).not.toContain("/cello:work")
  })
})

describe("pluginFolder", () => {
  it("is $XDG_DATA_HOME/cello/claude-plugin, else ~/.local/share/cello/claude-plugin", () => {
    expect(pluginFolder({ HOME: "/home/me", XDG_DATA_HOME: "/data" })).toBe("/data/cello/claude-plugin")
    expect(pluginFolder({ HOME: "/home/me" })).toBe("/home/me/.local/share/cello/claude-plugin")
    // The spec says a relative XDG_DATA_HOME is to be ignored.
    expect(pluginFolder({ HOME: "/home/me", XDG_DATA_HOME: "data" })).toBe("/home/me/.local/share/cello/claude-plugin")
    expect(pluginFolder({})).toBeNull()
  })
})

describe("writePluginFolder", () => {
  let dir = ""
  let folder = ""
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-plugin-")))
    folder = path.join(dir, "share", "cello", "claude-plugin")
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const files = [
    { path: ".claude-plugin/marketplace.json", text: "{ \"name\": \"cello\" }\n" },
    { path: "cello/commands/work.md", text: "Work.\n" },
  ]
  const read = (p: string) => fs.readFileSync(path.join(folder, p), "utf8")

  it("writes every file, creating the folders, and says it changed something", () => {
    expect(writePluginFolder(folder, files)).toEqual({ changed: true })
    expect(read(".claude-plugin/marketplace.json")).toBe("{ \"name\": \"cello\" }\n")
    expect(read("cello/commands/work.md")).toBe("Work.\n")
    expect(JSON.parse(read(OWN_FILES))).toEqual([".claude-plugin/marketplace.json", "cello/commands/work.md"])
  })

  it("writing the same files again changes nothing on disk", () => {
    writePluginFolder(folder, files)
    // Back-dated, so a rewrite would show as a new modification time.
    for (const p of [...files.map((f) => f.path), OWN_FILES]) fs.utimesSync(path.join(folder, p), new Date(0), new Date(0))
    expect(writePluginFolder(folder, files)).toEqual({ changed: false })
    for (const p of [...files.map((f) => f.path), OWN_FILES]) expect(fs.statSync(path.join(folder, p)).mtimeMs).toBe(0)
  })

  it("a newer Cello rewrites what changed and removes files it wrote that are gone, leaving files it didn't write", () => {
    writePluginFolder(folder, files)
    fs.writeFileSync(path.join(folder, "cello/commands/mine.md"), "The person's own.\n")
    const next = [{ path: ".claude-plugin/marketplace.json", text: "{ \"name\": \"cello\", \"v\": 2 }\n" }, { path: "cello/agents/builder.md", text: "Build.\n" }]
    expect(writePluginFolder(folder, next)).toEqual({ changed: true })
    expect(read(".claude-plugin/marketplace.json")).toBe("{ \"name\": \"cello\", \"v\": 2 }\n")
    expect(read("cello/agents/builder.md")).toBe("Build.\n")
    expect(fs.existsSync(path.join(folder, "cello/commands/work.md"))).toBe(false)
    expect(read("cello/commands/mine.md")).toBe("The person's own.\n")
    expect(JSON.parse(read(OWN_FILES))).toEqual([".claude-plugin/marketplace.json", "cello/agents/builder.md"])
  })

  it("never deletes outside the folder, even when its list of files names a path that leaves it", () => {
    const outside = path.join(dir, "precious.txt")
    fs.writeFileSync(outside, "keep me\n")
    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, OWN_FILES), JSON.stringify(["../../../precious.txt", outside, "cello/commands/work.md"]))
    writePluginFolder(folder, [files[0]!])
    expect(fs.readFileSync(outside, "utf8")).toBe("keep me\n")
  })

  it("replaces a symlink in its place with the file, leaving what the link pointed at alone", () => {
    const target = path.join(dir, "elsewhere.md")
    fs.writeFileSync(target, "not Cello's\n")
    fs.mkdirSync(path.join(folder, "cello/commands"), { recursive: true })
    fs.symlinkSync(target, path.join(folder, "cello/commands/work.md"))
    writePluginFolder(folder, files)
    expect(fs.lstatSync(path.join(folder, "cello/commands/work.md")).isSymbolicLink()).toBe(false)
    expect(read("cello/commands/work.md")).toBe("Work.\n")
    expect(fs.readFileSync(target, "utf8")).toBe("not Cello's\n")
  })

  it("refuses to write through a symlinked folder inside the plugin folder, leaving where it points alone", () => {
    const elsewhere = path.join(dir, "elsewhere")
    fs.mkdirSync(path.join(elsewhere, "commands"), { recursive: true })
    fs.writeFileSync(path.join(elsewhere, "commands", "work.md"), "not Cello's\n")
    fs.mkdirSync(folder, { recursive: true })
    fs.symlinkSync(elsewhere, path.join(folder, "cello"))
    expect(() => writePluginFolder(folder, files)).toThrow(`${path.join(folder, "cello")} is a symlink; Cello only writes real folders inside ${folder}`)
    expect(fs.readFileSync(path.join(elsewhere, "commands", "work.md"), "utf8")).toBe("not Cello's\n")
  })

  it("never removes a file it wrote earlier through a symlinked folder", () => {
    writePluginFolder(folder, files)
    const elsewhere = path.join(dir, "elsewhere")
    fs.mkdirSync(path.join(elsewhere, "commands"), { recursive: true })
    fs.writeFileSync(path.join(elsewhere, "commands", "work.md"), "not Cello's\n")
    fs.rmSync(path.join(folder, "cello"), { recursive: true })
    fs.symlinkSync(elsewhere, path.join(folder, "cello"))
    writePluginFolder(folder, [files[0]!])
    expect(fs.readFileSync(path.join(elsewhere, "commands", "work.md"), "utf8")).toBe("not Cello's\n")
  })

  it("works when the plugin folder itself is a symlink (dotfiles)", () => {
    const real = path.join(dir, "dotfiles", "claude-plugin")
    fs.mkdirSync(real, { recursive: true })
    fs.mkdirSync(path.dirname(folder), { recursive: true })
    fs.symlinkSync(real, folder)
    expect(writePluginFolder(folder, files)).toEqual({ changed: true })
    expect(fs.readFileSync(path.join(real, "cello/commands/work.md"), "utf8")).toBe("Work.\n")
  })

  it("skips a folder named in its list of files instead of failing on it", () => {
    fs.mkdirSync(path.join(folder, "cello", "commands"), { recursive: true })
    fs.writeFileSync(path.join(folder, OWN_FILES), JSON.stringify(["cello/commands", "cello"]))
    expect(writePluginFolder(folder, [files[0]!])).toEqual({ changed: true })
    expect(fs.existsSync(path.join(folder, "cello", "commands"))).toBe(true)
    expect(writePluginFolder(folder, [files[0]!])).toEqual({ changed: false })
  })

  it("refuses a file path that would leave the folder", () => {
    expect(() => writePluginFolder(folder, [{ path: "../escape.md", text: "x" }])).toThrow("outside")
    expect(fs.existsSync(path.join(folder, "..", "escape.md"))).toBe(false)
  })
})
