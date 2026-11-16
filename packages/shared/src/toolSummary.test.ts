import { describe, expect, it } from "vitest"
import { stepLine, toolTarget } from "./toolSummary.ts"

describe("toolTarget", () => {
  it.each([
    ["Bash", { command: "bun run test", description: "Run the tests" }, "bun run test"],
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
    ["TodoWrite", { todos: [] }, ""],
    ["mcp__thing__do", null, ""],
  ])("%s %j → %j", (name, input, target) => {
    expect(toolTarget(name, input as Record<string, unknown> | null)).toBe(target)
  })

  it("cuts a long target to one short line", () => {
    const target = toolTarget("Bash", { command: `echo ${"x".repeat(300)}` })
    expect(target.length).toBeLessThanOrEqual(80)
    expect(target.endsWith("…")).toBe(true)
  })
})

describe("stepLine", () => {
  it("is the tool and its target, or the tool alone", () => {
    expect(stepLine("Bash", { command: "bun run test" })).toBe("Bash · bun run test")
    expect(stepLine("TodoWrite", { todos: [] })).toBe("TodoWrite")
  })
})
