import { describe, expect, it } from "vitest"
import { stepLine, toolCommand, toolTarget } from "./toolSummary.ts"

describe("toolTarget", () => {
  it.each([
    ["Bash", { command: "bun run test", description: "Run the tests" }, "Run the tests"],
    ["Bash", { command: "bun run test", description: "  " }, "bun run test"],
    ["Bash", { command: "bun run test" }, "bun run test"],
    ["Bash", { command: "cd /repo &&\n  bun run typecheck" }, "cd /repo && bun run typecheck"],
    ["Edit", { file_path: "/repo/apps/web/src/FacetPanel.tsx", old_string: "a", new_string: "b" }, "FacetPanel.tsx"],
    ["Write", { file_path: "/repo/notes.md", content: "…" }, "notes.md"],
    ["Read", { file_path: "/repo/apps/server/src/viewer.ts" }, "viewer.ts"],
    ["NotebookEdit", { notebook_path: "/repo/a.ipynb" }, "a.ipynb"],
    ["Grep", { pattern: "agent.log", path: "/repo" }, "agent.log"],
    ["Glob", { pattern: "**/*.test.ts" }, "**/*.test.ts"],
    ["Agent", { subagent_type: "cello-builder", description: "CEL-106 build the log" }, "cello-builder: CEL-106 build the log"],
    ["Task", { description: "look around" }, "look around"],
    ["WebFetch", { url: "https://code.claude.com/docs/en/hooks", prompt: "…" }, "code.claude.com"],
    ["WebSearch", { query: "effect stream callback" }, "effect stream callback"],
    ["Skill", { skill: "cello:work" }, "cello:work"],
    ["Monitor", { description: "review-mode e2e run finishing", command: "until grep -q PASS out.txt; do sleep 5; done" }, "review-mode e2e run finishing"],
    ["TodoWrite", { todos: [] }, ""],
    ["mcp__thing__do", null, ""],
  ])("%s %j → %j", (name, input, target) => {
    expect(toolTarget(name, input as Record<string, unknown> | null)).toBe(target)
  })

  it("masks a key before cutting, so a key cut in half isn't left showing (CEL-106)", () => {
    const key = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
    const target = toolTarget("Bash", { command: `${"echo padding && ".repeat(3)}git push https://${key}@github.com/x/y.git` })
    expect(target).not.toContain(key.slice(0, 12))
  })

  it("masks a key in Claude's description too, and cuts it (CEL-170)", () => {
    const key = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8"
    expect(toolTarget("Bash", { command: "x", description: `Push with ${key}` })).not.toContain(key.slice(0, 12))
    const long = toolTarget("Bash", { command: "x", description: "y ".repeat(200) })
    expect(long.length).toBeLessThanOrEqual(80)
    expect(long.endsWith("…")).toBe(true)
  })

  it("cuts a long target to one short line", () => {
    const target = toolTarget("Bash", { command: `echo ${"x".repeat(300)}` })
    expect(target.length).toBeLessThanOrEqual(80)
    expect(target.endsWith("…")).toBe(true)
  })
})

describe("toolCommand", () => {
  it("is a Bash or Monitor call's command as written, not cut or masked (the server does that), and null for anything else (CEL-170)", () => {
    const command = `cd /repo &&\n  ${"x".repeat(300)}`
    expect(toolCommand("Bash", { command, description: "Run it" })).toBe(command)
    expect(toolCommand("Monitor", { command: "until grep -q PASS out.txt; do sleep 5; done", description: "waiting" })).toBe(
      "until grep -q PASS out.txt; do sleep 5; done",
    )
    expect(toolCommand("Read", { file_path: "/repo/a.ts" })).toBeNull()
    expect(toolCommand("Bash", { description: "no command" })).toBeNull()
    expect(toolCommand("Bash", null)).toBeNull()
  })
})

describe("stepLine", () => {
  it("is the tool and its target, or the tool alone", () => {
    expect(stepLine("Bash", { command: "bun run test", description: "Run the tests" })).toBe("Bash · Run the tests")
    expect(stepLine("Bash", { command: "bun run test" })).toBe("Bash · bun run test")
    expect(stepLine("TodoWrite", { todos: [] })).toBe("TodoWrite")
  })
})
