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
  addCelloPermission,
  addCelloPlugin,
  CELLO_HOOKS,
  CELLO_PERMISSION,
  celloHooksFor,
  detectFormat,
  formatSettings,
  installCello,
  readSettingsFile,
  removeCelloHooks,
  removeCelloPermission,
  removeCelloPlugin,
  uninstallCello,
  settingsPaths,
  writeFileAtomically,
} from "./claudeSettings.ts"

const stop = { type: "command", command: "cello hook claude stop", timeout: 10 }
const postToolUse = { type: "command", command: "cello hook claude post-tool-use", timeout: 10 }
const preToolUse = { type: "command", command: "cello hook claude pre-tool-use", timeout: 10 }
const subagentStart = { type: "command", command: "cello hook claude subagent-start", timeout: 10 }
const subagentStop = { type: "command", command: "cello hook claude subagent-stop", timeout: 10 }
/** The subagent hooks (CEL-55): SubagentStart only in a project's settings, SubagentStop everywhere. */
const subagents = { SubagentStart: [{ hooks: [subagentStart] }], SubagentStop: [{ hooks: [subagentStop] }] }

describe("addCelloHooks", () => {
  it("adds a Stop hook, a PostToolUse hook for every tool and a PreToolUse hook for Artifact and the edit tools to empty settings", () => {
    expect(addCelloHooks({})).toEqual({
      changed: true,
      settings: {
        hooks: {
          Stop: [{ hooks: [stop] }],
          PostToolUse: [{ matcher: "*", hooks: [postToolUse] }],
          PreToolUse: [{ matcher: "Artifact|Edit|Write|NotebookEdit", hooks: [preToolUse] }],
          ...subagents,
        },
      },
    })
    expect(CELLO_HOOKS.map((h) => h.event)).toEqual(["Stop", "PostToolUse", "PreToolUse", "SubagentStart", "SubagentStop"])
  })

  it("the artifact guard is for Cello projects only: user settings (every project) get just the comment hooks", () => {
    expect(celloHooksFor("project")).toEqual(CELLO_HOOKS)
    expect(addCelloHooks({}, celloHooksFor("user")).settings).toEqual({
      hooks: { Stop: [{ hooks: [stop] }], PostToolUse: [{ matcher: "*", hooks: [postToolUse] }], SubagentStop: subagents.SubagentStop },
    })
  })

  it("adds the guard to settings installed before it existed (CEL-15's two hooks), and nothing else", () => {
    const before = { hooks: { Stop: [{ hooks: [stop] }], PostToolUse: [{ matcher: "*", hooks: [postToolUse] }] } }
    expect(addCelloHooks(before)).toEqual({
      changed: true,
      settings: { hooks: { ...before.hooks, PreToolUse: [{ matcher: "Artifact|Edit|Write|NotebookEdit", hooks: [preToolUse] }], ...subagents } },
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
          ...subagents,
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
        ...subagents,
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
        ...subagents,
      },
    }
    expect(addCelloHooks(tuned)).toEqual({ changed: false, settings: tuned })
  })

  it("adds only the hook that's missing", () => {
    const half = { hooks: { Stop: [{ hooks: [stop] }] } }
    expect(addCelloHooks(half).settings).toEqual({
      hooks: {
        Stop: [{ hooks: [stop] }],
        PostToolUse: [{ matcher: "*", hooks: [postToolUse] }],
        PreToolUse: [{ matcher: "Artifact|Edit|Write|NotebookEdit", hooks: [preToolUse] }],
        ...subagents,
      },
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
  const both = { folder, declare: true, enable: true }

  it("declares Cello's marketplace (a folder on this machine) and enables cello@cello", () => {
    expect(addCelloPlugin({}, both)).toEqual({
      changed: true,
      off: false,
      settings: { extraKnownMarketplaces: marketplace, enabledPlugins: { "cello@cello": true } },
    })
  })

  it("can do just one of the two: --shared enables it in the committed file and declares the folder in the local one", () => {
    expect(addCelloPlugin({}, { folder, declare: false, enable: true }).settings).toEqual({ enabledPlugins: { "cello@cello": true } })
    expect(addCelloPlugin({}, { folder, declare: true, enable: false }).settings).toEqual({ extraKnownMarketplaces: marketplace })
  })

  it("keeps every other marketplace, plugin and setting; installing again changes nothing", () => {
    const mine = {
      model: "opus",
      enabledPlugins: { "formatter@team": true, "noisy@team": false },
      extraKnownMarketplaces: { team: { source: { source: "github", repo: "acme/plugins" } } },
    }
    const once = addCelloPlugin(mine, both)
    expect(once.settings).toEqual({
      model: "opus",
      enabledPlugins: { "formatter@team": true, "noisy@team": false, "cello@cello": true },
      extraKnownMarketplaces: { team: { source: { source: "github", repo: "acme/plugins" } }, ...marketplace },
    })
    expect(mine.enabledPlugins).not.toHaveProperty("cello@cello")
    expect(addCelloPlugin(once.settings, both)).toEqual({ changed: false, off: false, settings: once.settings })
  })

  it("keeps the extra keys someone put on Cello's marketplace entry (autoUpdate)", () => {
    const tuned = { extraKnownMarketplaces: { cello: { source: { source: "directory", path: folder }, autoUpdate: true } }, enabledPlugins: { "cello@cello": true } }
    expect(addCelloPlugin(tuned, both)).toEqual({ changed: false, off: false, settings: tuned })
  })

  it("leaves a plugin someone turned off (false) off, and says so", () => {
    const off = { extraKnownMarketplaces: marketplace, enabledPlugins: { "cello@cello": false } }
    expect(addCelloPlugin(off, both)).toEqual({ changed: false, off: true, settings: off })
    expect(installCello(off, { hooks: [], plugin: both, permission: false })).toMatchObject({ changed: false, plugin: false, off: true })
  })

  it("refuses a marketplace called cello that isn't exactly Cello's folder, even when it only enables (the committed file of --shared)", () => {
    const github = { extraKnownMarketplaces: { cello: { source: { source: "github", repo: "someone/cello" } } } }
    expect(() => addCelloPlugin(github, both)).toThrow("\"extraKnownMarketplaces.cello\" is another marketplace, not Cello's folder")
    expect(() => addCelloPlugin(github, { folder, declare: false, enable: true })).toThrow("\"extraKnownMarketplaces.cello\" is another marketplace")
    // A folder with the same last two names elsewhere isn't Cello's either (an older XDG_DATA_HOME, say).
    const moved = { extraKnownMarketplaces: { cello: { source: { source: "directory", path: "/old/cello/claude-plugin" } } } }
    expect(() => addCelloPlugin(moved, both)).toThrow("\"extraKnownMarketplaces.cello\" is another marketplace")
  })

  it("refuses settings it can't merge into", () => {
    expect(() => addCelloPlugin({ enabledPlugins: [] }, both)).toThrow("\"enabledPlugins\" isn't an object")
    expect(() => addCelloPlugin({ extraKnownMarketplaces: "x" }, both)).toThrow("\"extraKnownMarketplaces\" isn't an object")
    expect(() => addCelloPlugin([], both)).toThrow("isn't a JSON object")
  })
})

describe("removeCelloPlugin", () => {
  const folder = "/home/me/.local/share/cello/claude-plugin"
  const both = { folder, declare: true, enable: true }

  it("takes out cello@cello and Cello's marketplace, and the keys they leave empty; anything else stays", () => {
    const installed = addCelloPlugin({ model: "opus", enabledPlugins: { "formatter@team": true } }, both).settings
    expect(removeCelloPlugin(installed, folder)).toEqual({ changed: true, settings: { model: "opus", enabledPlugins: { "formatter@team": true } } })
    expect(removeCelloPlugin({ model: "opus" }, folder)).toEqual({ changed: false, settings: { model: "opus" } })
    // The committed file of --shared: enabled, with the marketplace declared elsewhere.
    expect(removeCelloPlugin({ enabledPlugins: { "cello@cello": true } }, folder)).toEqual({ changed: true, settings: {} })
  })

  it("leaves a marketplace called cello, and the cello@cello it enables, alone when it isn't Cello's folder", () => {
    const theirs = {
      extraKnownMarketplaces: { cello: { source: { source: "github", repo: "someone/cello" } } },
      enabledPlugins: { "cello@cello": true },
    }
    expect(removeCelloPlugin(theirs, folder)).toEqual({ changed: false, settings: theirs })
    const otherFolder = { extraKnownMarketplaces: { cello: { source: { source: "directory", path: "/old/cello/claude-plugin" } } } }
    expect(removeCelloPlugin(otherFolder, folder)).toEqual({ changed: false, settings: otherFolder })
  })

  it("install, then uninstall, gives back the same bytes", () => {
    const raw = `${JSON.stringify({ $schema: "s", enabledPlugins: { "a@b": true }, model: "opus" }, null, 4)}\n`
    const format = detectFormat(raw)
    const installed = formatSettings(installCello(JSON.parse(raw), { hooks: CELLO_HOOKS, plugin: both, permission: true }).settings, format)
    expect(Object.keys(JSON.parse(installed))).toEqual(["$schema", "enabledPlugins", "model", "hooks", "extraKnownMarketplaces", "permissions"])
    expect(formatSettings(uninstallCello(JSON.parse(installed), folder).settings, format)).toBe(raw)
  })
})

describe("addCelloPermission (CEL-90)", () => {
  it("allows cello commands: Bash(cello:*) in permissions.allow, so Claude Code's permission check never stands between an agent and the board", () => {
    expect(CELLO_PERMISSION).toBe("Bash(cello:*)")
    expect(addCelloPermission({})).toEqual({ changed: true, settings: { permissions: { allow: ["Bash(cello:*)"] } } })
  })

  it("adds it after the user's own rules, keeping deny, ask, the other permission keys and every other setting where they are", () => {
    const mine = {
      model: "opus",
      permissions: { defaultMode: "auto", allow: ["Bash(git status)", "Read"], deny: ["Bash(rm:*)"], ask: ["Bash(git push:*)"] },
      hooks: {},
    }
    const { settings, changed } = addCelloPermission(mine)
    expect(changed).toBe(true)
    expect(settings).toEqual({
      model: "opus",
      permissions: { defaultMode: "auto", allow: ["Bash(git status)", "Read", "Bash(cello:*)"], deny: ["Bash(rm:*)"], ask: ["Bash(git push:*)"] },
      hooks: {},
    })
    expect(Object.keys(settings)).toEqual(["model", "permissions", "hooks"])
    expect(Object.keys(settings.permissions as object)).toEqual(["defaultMode", "allow", "deny", "ask"])
    // The input isn't changed in place.
    expect(mine.permissions.allow).toEqual(["Bash(git status)", "Read"])
  })

  it("adds an allow list to permissions that have none, after the keys already there", () => {
    expect(addCelloPermission({ permissions: { deny: ["WebFetch"] } }).settings).toEqual({ permissions: { deny: ["WebFetch"], allow: ["Bash(cello:*)"] } })
  })

  it("is idempotent, and counts the same rule written the newer way (Bash(cello *)) as already there", () => {
    const once = addCelloPermission({}).settings
    expect(addCelloPermission(once)).toEqual({ changed: false, settings: once })
    const spaced = { permissions: { allow: ["Bash(cello *)"] } }
    expect(addCelloPermission(spaced)).toEqual({ changed: false, settings: spaced })
  })

  it("refuses permissions it can't merge into, instead of overwriting them", () => {
    expect(() => addCelloPermission([])).toThrow("isn't a JSON object")
    expect(() => addCelloPermission({ permissions: ["Bash(cello:*)"] })).toThrow("\"permissions\" isn't an object")
    expect(() => addCelloPermission({ permissions: { allow: "Bash(cello:*)" } })).toThrow("\"permissions.allow\" isn't a list")
  })
})

describe("removeCelloPermission", () => {
  it("takes out only Bash(cello:*); every other rule and permission key stays", () => {
    const installed = { permissions: { allow: ["Read", "Bash(cello:*)", "Bash(git status)"], deny: ["Bash(cello restore:*)"] } }
    expect(removeCelloPermission(installed)).toEqual({
      changed: true,
      settings: { permissions: { allow: ["Read", "Bash(git status)"], deny: ["Bash(cello restore:*)"] } },
    })
  })

  it("leaves no empty allow list or permissions object behind, and does nothing when it isn't there", () => {
    expect(removeCelloPermission(addCelloPermission({ model: "opus" }).settings)).toEqual({ changed: true, settings: { model: "opus" } })
    expect(removeCelloPermission({ permissions: { allow: ["Bash(cello:*)"], deny: ["WebFetch"] } }))
      .toEqual({ changed: true, settings: { permissions: { deny: ["WebFetch"] } } })
    expect(removeCelloPermission({ model: "opus" })).toEqual({ changed: false, settings: { model: "opus" } })
  })

  it("leaves a rule the user wrote the newer way (Bash(cello *)) alone: install didn't add it", () => {
    const spaced = { permissions: { allow: ["Bash(cello *)"] } }
    expect(removeCelloPermission(spaced)).toEqual({ changed: false, settings: spaced })
  })
})

describe("installCello / uninstallCello", () => {
  const folder = "/home/me/.local/share/cello/claude-plugin"
  const both = { folder, declare: true, enable: true }
  const everything = { hooks: CELLO_HOOKS, plugin: both, permission: true }

  it("merges the hooks, the plugin and the permission in one go and says which of them changed", () => {
    const installed = installCello({}, everything)
    expect(installed).toMatchObject({ changed: true, hooks: true, plugin: true, permission: true, off: false })
    expect(installed.settings).toMatchObject({ permissions: { allow: ["Bash(cello:*)"] } })
    // A file with the hooks from before the plugin existed: only the plugin and the permission are new.
    const hooksOnly = addCelloHooks({}).settings
    expect(installCello(hooksOnly, everything)).toMatchObject({ changed: true, hooks: false, plugin: true, permission: true })
    // A file installed before the permission existed (CEL-90): only the permission is new.
    const beforePermission = installCello({}, { ...everything, permission: false }).settings
    expect(beforePermission).not.toHaveProperty("permissions")
    expect(installCello(beforePermission, everything)).toMatchObject({ changed: true, hooks: false, plugin: false, permission: true })
    expect(installCello(installed.settings, everything))
      .toEqual({ changed: false, hooks: false, plugin: false, permission: false, off: false, settings: installed.settings })
    expect(uninstallCello(installed.settings, folder)).toEqual({ changed: true, hooks: true, plugin: true, permission: true, off: false, settings: {} })
    expect(uninstallCello(hooksOnly, folder)).toMatchObject({ changed: true, hooks: true, plugin: false, permission: false })
  })

  it("install, then uninstall, gives back the same bytes, with the user's own rules", () => {
    const raw = `${JSON.stringify({ permissions: { allow: ["Read"], deny: [] }, model: "opus" }, null, "\t")}\n`
    const format = detectFormat(raw)
    const installed = formatSettings(installCello(JSON.parse(raw), everything).settings, format)
    expect(JSON.parse(installed).permissions).toEqual({ allow: ["Read", "Bash(cello:*)"], deny: [] })
    expect(formatSettings(uninstallCello(JSON.parse(installed), folder).settings, format)).toBe(raw)
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
