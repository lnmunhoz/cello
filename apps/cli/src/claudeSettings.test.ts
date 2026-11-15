// `cello install claude` merges Cello's hooks into a Claude Code settings file without touching
// anything else, twice in a row changes nothing, and `cello uninstall claude` takes out only Cello's.
import { describe, expect, it } from "vitest"
import { addCelloHooks, CELLO_HOOKS, removeCelloHooks } from "./claudeSettings.ts"

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
