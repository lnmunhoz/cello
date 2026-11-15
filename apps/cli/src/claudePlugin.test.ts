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
      "cello/commands/work.md",
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
