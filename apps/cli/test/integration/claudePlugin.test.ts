// CEL-64: `cello install claude` installs Cello's Claude Code plugin (/cello:orchestrate, /cello:work,
// the cello skill, the builder and reviewer agents) next to its hooks. Each test uses a temp HOME and a
// temp repo, so the real ~/.claude and ~/.local/share are never touched.
import * as fs from "node:fs"
import * as path from "node:path"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { CLAUDE_PLUGIN_FILES } from "../../src/claudePlugin.ts"
import { installSetup } from "./cli.ts"

const pluginAt = (home: string) => path.join(home, ".local", "share", "cello", "claude-plugin")
const GIVES =
  "The plugin gives new sessions /cello:orchestrate (run tasks through builder and reviewer agents), /cello:work (do one task in this thread) and the cello skill."

describe("cello install claude: the plugin", () => {
  it.live("writes every file of the plugin to ~/.local/share/cello/claude-plugin, the folder the settings point at", () =>
    Effect.gen(function* () {
      const { repo, home, run } = yield* installSetup
      expect((yield* run(repo)("install", "claude")).failure).toBeNull()
      const folder = pluginAt(home)
      for (const file of CLAUDE_PLUGIN_FILES) expect(fs.readFileSync(path.join(folder, file.path), "utf8")).toBe(file.text)
      const settings = JSON.parse(fs.readFileSync(path.join(repo, ".claude", "settings.local.json"), "utf8"))
      expect(settings.extraKnownMarketplaces.cello.source.path).toBe(folder)
      expect(fs.existsSync(path.join(settings.extraKnownMarketplaces.cello.source.path, ".claude-plugin", "marketplace.json"))).toBe(true)
    }).pipe(Effect.scoped))

  it.live("uses $XDG_DATA_HOME/cello/claude-plugin when XDG_DATA_HOME is set", () =>
    Effect.gen(function* () {
      const { dir, repo, home, run } = yield* installSetup
      const data = path.join(dir, "xdg-data")
      const installed = yield* run(repo, undefined, { XDG_DATA_HOME: data })("install", "claude")
      expect(installed.failure).toBeNull()
      expect(fs.existsSync(path.join(data, "cello", "claude-plugin", "cello", "commands", "orchestrate.md"))).toBe(true)
      expect(fs.existsSync(pluginAt(home))).toBe(false)
    }).pipe(Effect.scoped))

  it.live("a project set up before the plugin existed gets it on the next install, and its hooks stay as they were", () =>
    Effect.gen(function* () {
      const { repo, home, run } = yield* installSetup
      const file = path.join(repo, ".claude", "settings.local.json")
      fs.mkdirSync(path.dirname(file))
      const hooksOnly = {
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "cello hook claude stop", timeout: 10 }] }],
          PostToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "cello hook claude post-tool-use", timeout: 10 }] }],
          PreToolUse: [{ matcher: "Artifact|Edit|Write|NotebookEdit", hooks: [{ type: "command", command: "cello hook claude pre-tool-use", timeout: 10 }] }],
        },
      }
      fs.writeFileSync(file, `${JSON.stringify(hooksOnly, null, 2)}\n`)
      fs.writeFileSync(path.join(repo, ".gitignore"), ".claude/settings.local.json\n")
      expect(yield* run(repo)("install", "claude")).toEqual({
        out: [
          `Cello's Claude Code hooks are already in ${file}.`,
          `Enabled Cello's Claude Code plugin in ${file}; its files are in ${pluginAt(home)}.`,
          `Kept the old file as ${file}.bak.`,
          GIVES,
          "New Claude Code sessions pick them up.",
        ].join("\n"),
        failure: null,
      })
      expect(JSON.parse(fs.readFileSync(file, "utf8")).hooks).toEqual(hooksOnly.hooks)
    }).pipe(Effect.scoped))

  it.live("a newer Cello rewrites the plugin's files on install, without touching the settings", () =>
    Effect.gen(function* () {
      const { repo, home, run } = yield* installSetup
      yield* run(repo)("install", "claude")
      const file = path.join(repo, ".claude", "settings.local.json")
      const settings = fs.readFileSync(file, "utf8")
      // What an older Cello wrote.
      const orchestrate = path.join(pluginAt(home), "cello", "commands", "orchestrate.md")
      fs.writeFileSync(orchestrate, "An older orchestrator.\n")
      expect(yield* run(repo)("install", "claude")).toEqual({
        out: [
          `Cello's Claude Code hooks are already in ${file}.`,
          `Updated Cello's Claude Code plugin in ${pluginAt(home)}; it's already enabled in ${file}.`,
          GIVES,
          "New Claude Code sessions pick them up.",
        ].join("\n"),
        failure: null,
      })
      expect(fs.readFileSync(orchestrate, "utf8")).toBe(CLAUDE_PLUGIN_FILES.find((f) => f.path === "cello/commands/orchestrate.md")!.text)
      expect(fs.readFileSync(file, "utf8")).toBe(settings)
    }).pipe(Effect.scoped))

  it.live("refuses to replace a marketplace called cello that isn't Cello's, and changes no settings", () =>
    Effect.gen(function* () {
      const { repo, run } = yield* installSetup
      const file = path.join(repo, ".claude", "settings.local.json")
      fs.mkdirSync(path.dirname(file))
      const theirs = `${JSON.stringify({ extraKnownMarketplaces: { cello: { source: { source: "github", repo: "someone/cello" } } } }, null, 2)}\n`
      fs.writeFileSync(file, theirs)
      expect(yield* run(repo)("install", "claude")).toEqual({
        out: "",
        failure: `Can't update ${file}: "extraKnownMarketplaces.cello" is another marketplace, not Cello's folder. Fix it first; Cello won't overwrite it.`,
      })
      expect(fs.readFileSync(file, "utf8")).toBe(theirs)
    }).pipe(Effect.scoped))

  it.live("never writes the plugin inside Cello's data folder", () =>
    Effect.gen(function* () {
      const { dir, repo, run } = yield* installSetup
      const dataDir = path.join(dir, "data")
      const installed = yield* run(repo, undefined, { CELLO_DATA_DIR: dataDir, XDG_DATA_HOME: dataDir })("install", "claude")
      expect(installed).toEqual({
        out: "",
        failure: `The plugin's folder ${path.join(dataDir, "cello", "claude-plugin")} is inside Cello's data folder; set XDG_DATA_HOME to somewhere else.`,
      })
      expect(fs.existsSync(path.join(dataDir, "cello"))).toBe(false)
      expect(fs.existsSync(path.join(repo, ".claude"))).toBe(false)
    }).pipe(Effect.scoped))
})
