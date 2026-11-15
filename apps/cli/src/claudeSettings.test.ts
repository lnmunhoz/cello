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
  CELLO_HOOKS,
  detectFormat,
  formatSettings,
  readSettingsFile,
  removeCelloHooks,
  settingsPaths,
  writeFileAtomically,
} from "./claudeSettings.ts"

const stop = { type: "command", command: "cello hook claude stop", timeout: 10 }
const postToolUse = { type: "command", command: "cello hook claude post-tool-use", timeout: 10 }

describe("addCelloHooks", () => {
  it("adds a Stop hook and a PostToolUse hook for every tool to empty settings", () => {
    expect(addCelloHooks({})).toEqual({
      changed: true,
      settings: {
        hooks: {
          Stop: [{ hooks: [stop] }],
          PostToolUse: [{ matcher: "*", hooks: [postToolUse] }],
        },
      },
    })
    expect(CELLO_HOOKS.map((h) => h.event)).toEqual(["Stop", "PostToolUse"])
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
      },
    })
    // The input isn't changed in place.
    expect(mine.hooks.Stop).toHaveLength(1)
  })

  it("is idempotent: installing again changes nothing, even when the user tuned a hook", () => {
    const once = addCelloHooks({}).settings
    expect(addCelloHooks(once)).toEqual({ changed: false, settings: once })
    const tuned = { hooks: { Stop: [{ hooks: [{ ...stop, timeout: 30 }] }], PostToolUse: [{ matcher: "*", hooks: [postToolUse] }] } }
    expect(addCelloHooks(tuned)).toEqual({ changed: false, settings: tuned })
  })

  it("adds only the hook that's missing", () => {
    const half = { hooks: { Stop: [{ hooks: [stop] }] } }
    expect(addCelloHooks(half).settings).toEqual({
      hooks: { Stop: [{ hooks: [stop] }], PostToolUse: [{ matcher: "*", hooks: [postToolUse] }] },
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
    expect(() => writeFileAtomically(file, "{ \"new\": true }\n", full)).toThrow("ENOSPC")
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
