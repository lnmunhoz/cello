// `cello install claude` merges Cello's hooks into a Claude Code settings file without touching
// anything else, twice in a row changes nothing, and `cello uninstall claude` takes out only Cello's.
// The file is replaced atomically (temp file, fsync, rename) with the old bytes kept in `.bak`, and
// its key order and indentation survive.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  addCelloHooks,
  addCelloPlugin,
  CELLO_HOOKS,
  celloHooksFor,
  detectFormat,
  formatSettings,
  installCello,
  readSettingsFile,
  removeCelloHooks,
  removeCelloPlugin,
  uninstallCello,
  settingsPaths,
  writeFileAtomically,
} from "./claudeSettings.ts"

const stop = { type: "command", command: "cello hook claude stop", timeout: 10 }
const postToolUse = { type: "command", command: "cello hook claude post-tool-use", timeout: 10 }
const preToolUse = { type: "command", command: "cello hook claude pre-tool-use", timeout: 10 }

describe("addCelloHooks", () => {
  it("adds a Stop hook, a PostToolUse hook for every tool and a PreToolUse hook for Artifact and the edit tools to empty settings", () => {
    expect(addCelloHooks({})).toEqual({
      changed: true,
      settings: {
        hooks: {
          Stop: [{ hooks: [stop] }],
          PostToolUse: [{ matcher: "*", hooks: [postToolUse] }],
          PreToolUse: [{ matcher: "Artifact|Edit|Write|NotebookEdit", hooks: [preToolUse] }],
        },
      },
    })
    expect(CELLO_HOOKS.map((h) => h.event)).toEqual(["Stop", "PostToolUse", "PreToolUse"])
  })

  it("the artifact guard is for Cello projects only: user settings (every project) get just the comment hooks", () => {
    expect(celloHooksFor("project")).toEqual(CELLO_HOOKS)
    expect(addCelloHooks({}, celloHooksFor("user")).settings).toEqual({
      hooks: { Stop: [{ hooks: [stop] }], PostToolUse: [{ matcher: "*", hooks: [postToolUse] }] },
    })
  })

  it("adds the guard to settings installed before it existed (CEL-15's two hooks), and nothing else", () => {
    const before = { hooks: { Stop: [{ hooks: [stop] }], PostToolUse: [{ matcher: "*", hooks: [postToolUse] }] } }
    expect(addCelloHooks(before)).toEqual({
      changed: true,
      settings: { hooks: { ...before.hooks, PreToolUse: [{ matcher: "Artifact|Edit|Write|NotebookEdit", hooks: [preToolUse] }] } },
    })
  })

  it("widens the guard of an older install (matcher Artifact, CEL-57) to the edit tools, in place of the old group (CEL-61)", () => {
    const mine = { matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }
    const before = {
      hooks: {
        Stop: [{ hooks: [stop] }],
        PostToolUse: [{ matcher: "*", hooks: [postToolUse] }],
        PreToolUse: [{ matcher: "Artifact", hooks: [preToolUse] }, mine, { matcher: "Artifact", hooks: [{ type: "command", command: "log.sh" }, preToolUse] }],
      },
    }
    const after = addCelloHooks(before)
    expect(after).toEqual({
      changed: true,
      settings: {
        hooks: {
          ...before.hooks,
          PreToolUse: [mine, { matcher: "Artifact", hooks: [{ type: "command", command: "log.sh" }] }, { matcher: "Artifact|Edit|Write|NotebookEdit", hooks: [preToolUse] }],
        },
      },
    })
    expect(addCelloHooks(after.settings)).toEqual({ changed: false, settings: after.settings })
  })

  it("keeps the user's own PreToolUse hooks, adding its group after them", () => {
    const mine = { hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }] } }
    expect(addCelloHooks(mine).settings.hooks).toMatchObject({
      PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "guard.sh" }] }, { matcher: "Artifact|Edit|Write|NotebookEdit", hooks: [preToolUse] }],
    })
    expect(removeCelloHooks(addCelloHooks(mine).settings)).toEqual({ changed: true, settings: mine })
  })

  it("keeps every other setting and hook, adding its own groups after them", () => {
    const mine = {
      model: "opus",
      permissions: { allow: ["Bash(cello *)"] },
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
        PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "prettier --write" }] }],
        SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }],
      },
    }
    const { settings, changed } = addCelloHooks(mine)
    expect(changed).toBe(true)
    expect(settings).toEqual({
      model: "opus",
      permissions: { allow: ["Bash(cello *)"] },
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "say done" }] }, { hooks: [stop] }],
        PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "prettier --write" }] }, { matcher: "*", hooks: [postToolUse] }],
        SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }],
        PreToolUse: [{ matcher: "Artifact|Edit|Write|NotebookEdit", hooks: [preToolUse] }],
      },
    })
    // The input isn't changed in place.
    expect(mine.hooks.Stop).toHaveLength(1)
  })

  it("is idempotent: installing again changes nothing, even when the user tuned a hook", () => {
    const once = addCelloHooks({}).settings
    expect(addCelloHooks(once)).toEqual({ changed: false, settings: once })
    const tuned = {
      hooks: {
        Stop: [{ hooks: [{ ...stop, timeout: 30 }] }],
        PostToolUse: [{ matcher: "*", hooks: [postToolUse] }],
        PreToolUse: [{ matcher: "Artifact|Edit|Write|NotebookEdit", hooks: [{ ...preToolUse, timeout: 5 }] }],
      },
    }
    expect(addCelloHooks(tuned)).toEqual({ changed: false, settings: tuned })
  })

  it("adds only the hook that's missing", () => {
    const half = { hooks: { Stop: [{ hooks: [stop] }] } }
    expect(addCelloHooks(half).settings).toEqual({
      hooks: { Stop: [{ hooks: [stop] }], PostToolUse: [{ matcher: "*", hooks: [postToolUse] }], PreToolUse: [{ matcher: "Artifact|Edit|Write|NotebookEdit", hooks: [preToolUse] }] },
    })
  })

  it("refuses settings it can't merge into, instead of overwriting them", () => {
    expect(() => addCelloHooks([])).toThrow("isn't a JSON object")
    expect(() => addCelloHooks({ hooks: "nope" })).toThrow("\"hooks\" isn't an object")
    expect(() => addCelloHooks({ hooks: { Stop: {} } })).toThrow("\"hooks.Stop\" isn't a list")
  })
})

describe("removeCelloHooks", () => {
  it("takes out only Cello's handlers, then any group and event they leave empty", () => {
    const installed = addCelloHooks({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "say done" }, { type: "command", command: "cello hook claude stop" }] }],
        SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }],
      },
    }).settings
    expect(removeCelloHooks(installed)).toEqual({
      changed: true,
      settings: {
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "say done" }] }],
          SessionStart: [{ hooks: [{ type: "command", command: "echo hi" }] }],
        },
      },
    })
  })

  it("leaves no empty hooks object behind, and does nothing when Cello isn't installed", () => {
    expect(removeCelloHooks(addCelloHooks({ model: "opus" }).settings)).toEqual({ changed: true, settings: { model: "opus" } })
    expect(removeCelloHooks({ model: "opus" })).toEqual({ changed: false, settings: { model: "opus" } })
  })
})

describe("addCelloPlugin (CEL-64)", () => {
  const folder = "/home/me/.local/share/cello/claude-plugin"
  const marketplace = { cello: { source: { source: "directory", path: folder } } }

  it("declares Cello's marketplace (a folder on this machine) and enables cello@cello", () => {
    expect(addCelloPlugin({}, { marketplace: folder, enable: true })).toEqual({
      changed: true,
      settings: { extraKnownMarketplaces: marketplace, enabledPlugins: { "cello@cello": true } },
    })
  })

  it("can do just one of the two: --shared enables it in the committed file and declares the folder in the local one", () => {
    expect(addCelloPlugin({}, { marketplace: null, enable: true }).settings).toEqual({ enabledPlugins: { "cello@cello": true } })
    expect(addCelloPlugin({}, { marketplace: folder, enable: false }).settings).toEqual({ extraKnownMarketplaces: marketplace })
  })

  it("keeps every other marketplace, plugin and setting; installing again changes nothing", () => {
    const mine = {
      model: "opus",
      enabledPlugins: { "formatter@team": true, "noisy@team": false },
      extraKnownMarketplaces: { team: { source: { source: "github", repo: "acme/plugins" } } },
    }
    const once = addCelloPlugin(mine, { marketplace: folder, enable: true })
    expect(once.settings).toEqual({
      model: "opus",
      enabledPlugins: { "formatter@team": true, "noisy@team": false, "cello@cello": true },
      extraKnownMarketplaces: { team: { source: { source: "github", repo: "acme/plugins" } }, ...marketplace },
    })
    expect(mine.enabledPlugins).not.toHaveProperty("cello@cello")
    expect(addCelloPlugin(once.settings, { marketplace: folder, enable: true })).toEqual({ changed: false, settings: once.settings })
  })

  it("points the marketplace at the new folder when it moved (XDG_DATA_HOME changed), and turns a disabled plugin back on", () => {
    const old = { extraKnownMarketplaces: { cello: { source: { source: "directory", path: "/old/cello/claude-plugin" } } }, enabledPlugins: { "cello@cello": false } }
    expect(addCelloPlugin(old, { marketplace: folder, enable: true })).toEqual({
      changed: true,
      settings: { extraKnownMarketplaces: marketplace, enabledPlugins: { "cello@cello": true } },
    })
  })

  it("refuses a marketplace called cello that isn't Cello's folder, and settings it can't merge into", () => {
    expect(() => addCelloPlugin({ extraKnownMarketplaces: { cello: { source: { source: "github", repo: "someone/cello" } } } }, { marketplace: folder, enable: true }))
      .toThrow("\"extraKnownMarketplaces.cello\" is another marketplace")
    expect(() => addCelloPlugin({ enabledPlugins: [] }, { marketplace: folder, enable: true })).toThrow("\"enabledPlugins\" isn't an object")
    expect(() => addCelloPlugin({ extraKnownMarketplaces: "x" }, { marketplace: folder, enable: true })).toThrow("\"extraKnownMarketplaces\" isn't an object")
    expect(() => addCelloPlugin([], { marketplace: folder, enable: true })).toThrow("isn't a JSON object")
  })
})

describe("removeCelloPlugin", () => {
  const folder = "/home/me/.local/share/cello/claude-plugin"

  it("takes out cello@cello and Cello's marketplace, and the keys they leave empty; anything else stays", () => {
    const installed = addCelloPlugin({ model: "opus", enabledPlugins: { "formatter@team": true } }, { marketplace: folder, enable: true }).settings
    expect(removeCelloPlugin(installed)).toEqual({ changed: true, settings: { model: "opus", enabledPlugins: { "formatter@team": true } } })
    expect(removeCelloPlugin({ model: "opus" })).toEqual({ changed: false, settings: { model: "opus" } })
  })

  it("leaves a marketplace called cello alone when it isn't Cello's folder", () => {
    const theirs = { extraKnownMarketplaces: { cello: { source: { source: "github", repo: "someone/cello" } } } }
    expect(removeCelloPlugin(theirs)).toEqual({ changed: false, settings: theirs })
  })

  it("install, then uninstall, gives back the same bytes", () => {
    const raw = `${JSON.stringify({ $schema: "s", enabledPlugins: { "a@b": true }, model: "opus" }, null, 4)}\n`
    const format = detectFormat(raw)
    const installed = formatSettings(installCello(JSON.parse(raw), { hooks: CELLO_HOOKS, plugin: { marketplace: folder, enable: true } }).settings, format)
    expect(Object.keys(JSON.parse(installed))).toEqual(["$schema", "enabledPlugins", "model", "hooks", "extraKnownMarketplaces"])
    expect(formatSettings(uninstallCello(JSON.parse(installed)).settings, format)).toBe(raw)
  })
})

describe("installCello / uninstallCello", () => {
  const folder = "/home/me/.local/share/cello/claude-plugin"

  it("merges the hooks and the plugin in one go and says which of them changed", () => {
    const both = installCello({}, { hooks: CELLO_HOOKS, plugin: { marketplace: folder, enable: true } })
    expect(both).toMatchObject({ changed: true, hooks: true, plugin: true })
    // A file with the hooks from before the plugin existed: only the plugin is new.
    const hooksOnly = addCelloHooks({}).settings
    expect(installCello(hooksOnly, { hooks: CELLO_HOOKS, plugin: { marketplace: folder, enable: true } })).toMatchObject({ changed: true, hooks: false, plugin: true })
    expect(installCello(both.settings, { hooks: CELLO_HOOKS, plugin: { marketplace: folder, enable: true } })).toEqual({ changed: false, hooks: false, plugin: false, settings: both.settings })
    expect(uninstallCello(both.settings)).toEqual({ changed: true, hooks: true, plugin: true, settings: {} })
    expect(uninstallCello(hooksOnly)).toMatchObject({ changed: true, hooks: true, plugin: false })
  })
})

describe("formatting", () => {
  const roundTrip = (raw: string) => {
    const format = detectFormat(raw)
    const installed = formatSettings(addCelloHooks(JSON.parse(raw)).settings, format)
    return { installed, uninstalled: formatSettings(removeCelloHooks(JSON.parse(installed)).settings, format) }
  }

  it("keeps the file's indentation and key order: install, then uninstall, gives back the same bytes", () => {
    const settings = {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
      permissions: { allow: ["Bash(cello *)"], deny: [] },
      hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }] }] },
      model: "opus",
    }
    for (const indent of ["    ", "\t", "  "]) {
      const raw = `${JSON.stringify(settings, null, indent)}\n`
      const { installed, uninstalled } = roundTrip(raw)
      expect(Object.keys(JSON.parse(installed))).toEqual(["$schema", "permissions", "hooks", "model"])
      expect(installed.split("\n")[1]).toBe(`${indent}"$schema": "https://json.schemastore.org/claude-code-settings.json",`)
      expect(uninstalled).toBe(raw)
    }
  })

  it("puts a new hooks key at the end, and takes it away again without moving anything", () => {
    const raw = `${JSON.stringify({ model: "opus", env: { A: "1" } }, null, 4)}`
    const { installed, uninstalled } = roundTrip(raw)
    expect(Object.keys(JSON.parse(installed))).toEqual(["model", "env", "hooks"])
    // No newline at the end before, none after.
    expect(uninstalled).toBe(raw)
  })

  it("new files get two spaces and a final newline", () => {
    expect(detectFormat("")).toEqual({ indent: "  ", newline: "\n" })
    expect(formatSettings({ a: 1 }, detectFormat(""))).toBe("{\n  \"a\": 1\n}\n")
  })
})

describe("writeFileAtomically", () => {
  let dir = ""
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-settings-")))
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  const leftovers = (folder: string) => fs.readdirSync(folder).filter((f) => f.includes(".cello-") && f.endsWith(".tmp"))

  it("replaces the file through a temp file in the same folder, keeping the old bytes in .bak and the file's mode", () => {
    const file = path.join(dir, "settings.json")
    fs.writeFileSync(file, "{ \"old\": true }\n", { mode: 0o600 })
    fs.chmodSync(file, 0o600)
    expect(writeFileAtomically(file, "{ \"new\": true }\n")).toEqual({ target: file, backup: `${file}.bak` })
    expect(fs.readFileSync(file, "utf8")).toBe("{ \"new\": true }\n")
    expect(fs.readFileSync(`${file}.bak`, "utf8")).toBe("{ \"old\": true }\n")
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
    expect(leftovers(dir)).toEqual([])
  })

  it("a write that fails part way (a full disk) leaves the original as it was and no temp file", () => {
    const file = path.join(dir, "settings.json")
    fs.writeFileSync(file, "{ \"old\": true }\n")
    const full = { writeSync: () => { throw Object.assign(new Error("ENOSPC: no space left on device"), { code: "ENOSPC" }) } }
    expect(() => writeFileAtomically(file, "{ \"new\": true }\n", { io: full })).toThrow("ENOSPC")
    expect(fs.readFileSync(file, "utf8")).toBe("{ \"old\": true }\n")
    expect(leftovers(dir)).toEqual([])
    expect(fs.existsSync(`${file}.bak`)).toBe(false)
  })

  it("through a symlink (chezmoi, dotfiles), replaces the real file and leaves the link in place", () => {
    const real = path.join(dir, "dotfiles", "settings.json")
    fs.mkdirSync(path.dirname(real))
    fs.writeFileSync(real, "{}\n")
    const link = path.join(dir, "home", ".claude", "settings.json")
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.symlinkSync(real, link)

    expect(writeFileAtomically(link, "{ \"a\": 1 }\n")).toEqual({ target: real, backup: `${real}.bak` })
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(link, "utf8")).toBe("{ \"a\": 1 }\n")
    expect(fs.readFileSync(`${real}.bak`, "utf8")).toBe("{}\n")
    expect(leftovers(path.dirname(real))).toEqual([])
  })

  it("backup: false replaces the file the same way without keeping a .bak", () => {
    const file = path.join(dir, "AGENTS.md")
    fs.writeFileSync(file, "old\n")
    expect(writeFileAtomically(file, "new\n", { backup: false })).toEqual({ target: file, backup: null })
    expect(fs.readFileSync(file, "utf8")).toBe("new\n")
    expect(fs.existsSync(`${file}.bak`)).toBe(false)
    expect(leftovers(dir)).toEqual([])
  })

  it("backup: \"new\" leaves an existing .bak alone and keeps the copy in the first free .bak.N", () => {
    const file = path.join(dir, "AGENTS.md")
    fs.writeFileSync(`${file}.bak`, "oldest\n")
    fs.writeFileSync(file, "one\n")
    expect(writeFileAtomically(file, "two\n", { backup: "new" }).backup).toBe(`${file}.bak.1`)
    expect(writeFileAtomically(file, "three\n", { backup: "new" }).backup).toBe(`${file}.bak.2`)
    expect([fs.readFileSync(`${file}.bak`, "utf8"), fs.readFileSync(`${file}.bak.1`, "utf8"), fs.readFileSync(`${file}.bak.2`, "utf8")])
      .toEqual(["oldest\n", "one\n", "two\n"])
  })

  it("creates a new file and its folder, with no .bak", () => {
    const file = path.join(dir, "project", ".claude", "settings.local.json")
    expect(writeFileAtomically(file, "{}\n")).toEqual({ target: file, backup: null })
    expect(fs.readFileSync(file, "utf8")).toBe("{}\n")
  })

  it("reads a missing or empty file as empty settings, and refuses broken JSON", () => {
    expect(readSettingsFile(path.join(dir, "none.json")).settings).toEqual({})
    fs.writeFileSync(path.join(dir, "empty.json"), "")
    expect(readSettingsFile(path.join(dir, "empty.json")).settings).toEqual({})
    fs.writeFileSync(path.join(dir, "broken.json"), "{ broken")
    expect(() => readSettingsFile(path.join(dir, "broken.json"))).toThrow("it isn't valid JSON")
  })
})

describe("settingsPaths", () => {
  it("names the project's local and shared files and the user's", () => {
    expect(settingsPaths({ projectRoot: "/repo", home: "/home/me" })).toEqual({
      local: "/repo/.claude/settings.local.json",
      shared: "/repo/.claude/settings.json",
      user: "/home/me/.claude/settings.json",
    })
    expect(settingsPaths({ projectRoot: "/repo", home: undefined }).user).toBeNull()
  })
})
