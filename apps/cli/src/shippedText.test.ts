// Cello is public: anyone can point their agent at it and set it up for their own board (CEL-95).
// What it writes into their repos and sessions speaks of "the human" who owns the board, or uses the
// name the board knows them by, never the name of the person who happens to maintain Cello (CEL-98).
import { describe, expect, it } from "vitest"
import { agentsSection } from "./agentsMd.ts"
import { ARTIFACT_DENY_REASON, claimDenyReason } from "./claudeHook.ts"
import { CLAUDE_PLUGIN_FILES } from "./claudePluginFiles.ts"
import { GUIDE } from "./guide.ts"

const MAINTAINER = /\bLucas\b/

describe("text Cello ships into other people's repos and sessions", () => {
  it("`cello guide` (docs/cli.md, the command reference included) names no particular person", () => {
    const lines = GUIDE.split("\n").filter((line) => MAINTAINER.test(line))
    expect(lines).toEqual([])
  })

  it("the AGENTS.md section `cello init --agents-md` writes speaks of the human who owns the board", () => {
    const section = agentsSection(GUIDE, "THAI")
    expect(section).not.toMatch(MAINTAINER)
    expect(section).toContain("the human")
  })

  it("the Claude Code plugin and the hooks' messages name no particular person", () => {
    for (const file of CLAUDE_PLUGIN_FILES) expect(file.text, file.path).not.toMatch(MAINTAINER)
    expect(ARTIFACT_DENY_REASON).not.toMatch(MAINTAINER)
    expect(claimDenyReason("THAI")).not.toMatch(MAINTAINER)
  })
})
