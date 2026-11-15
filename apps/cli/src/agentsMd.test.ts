// `cello init --agents-md`: the "Tracking work in Cello" section comes from docs/cli.md (through
// `cello guide`'s copy of it), so the command and the doc can't say different things.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { addAgentsSection, AGENTS_HEADING, agentsFile, agentsSection, withAgentsSection } from "./agentsMd.ts"
import { GUIDE } from "./guide.ts"

describe("agentsSection", () => {
  it("is the snippet between docs/cli.md's agents-md markers, unindented, without its fence, with KEY replaced", () => {
    const section = agentsSection(GUIDE, "THAI")
    expect(section.startsWith(`${AGENTS_HEADING}\n\nThis repo's tasks live in Cello, project **THAI** on Lucas's board.`)).toBe(true)
    expect(section).toContain("(`cello task claim THAI-n`)")
    expect(section).toContain("(THAI-12)")
    expect(section).not.toMatch(/\bKEY\b/)
    expect(section).not.toContain("```")
    expect(section).not.toMatch(/^ /m)
    expect(section.endsWith("\n")).toBe(false)
  })

  it("fails loudly when the doc lost its markers", () => {
    expect(() => agentsSection("# No markers here", "THAI")).toThrow(/agents-md/)
  })
})

describe("withAgentsSection", () => {
  const section = `${AGENTS_HEADING}\n\nUse cello.`

  it("appends the section after what's there, separated by a blank line", () => {
    expect(withAgentsSection("# Repo\n\nRules.\n", section)).toEqual({ text: `# Repo\n\nRules.\n\n${section}\n`, changed: true })
    expect(withAgentsSection("# Repo\n\nRules.", section).text).toBe(`# Repo\n\nRules.\n\n${section}\n`)
    expect(withAgentsSection("# Repo\n\n", section).text).toBe(`# Repo\n\n${section}\n`)
    expect(withAgentsSection("", section).text).toBe(`${section}\n`)
  })

  it("changes nothing when the file already has a Tracking work in Cello heading, at any level or with words after it", () => {
    for (const heading of [AGENTS_HEADING, "### Tracking work in Cello", "## Tracking work in Cello (THAI)", "##   tracking work in cello  "]) {
      const current = `# Repo\n\n${heading}\n\nOur own words.\n\n## Other\n`
      expect(withAgentsSection(current, section), heading).toEqual({ text: current, changed: false })
    }
    const crlf = `# Repo\r\n\r\n${AGENTS_HEADING}\r\n\r\nOurs.\r\n`
    expect(withAgentsSection(crlf, section)).toEqual({ text: crlf, changed: false })
    // A mention in a sentence isn't the heading.
    expect(withAgentsSection("We like Tracking work in Cello.\n", section).changed).toBe(true)
  })

  it("uses the file's own line endings", () => {
    expect(withAgentsSection("# Repo\r\n\r\nRules.", section).text).toBe(`# Repo\r\n\r\nRules.\r\n\r\n${AGENTS_HEADING}\r\n\r\nUse cello.\r\n`)
    expect(withAgentsSection("# Repo\r\n\r\nRules.\r\n\r\n", section).text).toBe(`# Repo\r\n\r\nRules.\r\n\r\n${AGENTS_HEADING}\r\n\r\nUse cello.\r\n`)
  })
})

describe("addAgentsSection", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-agents-add-")))
  afterAll(() => fs.rmSync(base, { recursive: true, force: true }))

  it("refuses an AGENTS.md or CLAUDE.md that's a symlink to nothing, instead of creating a file outside the repo", () => {
    for (const name of ["AGENTS.md", "CLAUDE.md"]) {
      const checkout = fs.mkdtempSync(path.join(base, "co-"))
      const target = path.join(base, `nowhere-${name}`)
      fs.symlinkSync(target, path.join(checkout, name))
      expect(() => addAgentsSection(checkout, GUIDE, "THAI"), name).toThrow(`${name} is a symlink to ${target}, which doesn't exist`)
      expect(fs.existsSync(target)).toBe(false)
      expect(fs.existsSync(path.join(checkout, name === "AGENTS.md" ? "CLAUDE.md" : "AGENTS.md"))).toBe(false)
    }
  })
})

describe("agentsFile", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-agents-")))
  afterAll(() => fs.rmSync(base, { recursive: true, force: true }))
  const folder = (name: string, files: ReadonlyArray<string>) => {
    const dir = path.join(base, name)
    fs.mkdirSync(dir)
    for (const file of files) fs.writeFileSync(path.join(dir, file), "")
    return dir
  }

  it("is AGENTS.md when there is one, else CLAUDE.md, which is created when neither exists", () => {
    expect(agentsFile(folder("both", ["AGENTS.md", "CLAUDE.md"]))).toBe(path.join(base, "both", "AGENTS.md"))
    expect(agentsFile(folder("claude", ["CLAUDE.md"]))).toBe(path.join(base, "claude", "CLAUDE.md"))
    expect(agentsFile(folder("none", []))).toBe(path.join(base, "none", "CLAUDE.md"))
  })
})
