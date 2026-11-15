// `cello init --agents-md`: the "Tracking work in Cello" section comes from docs/cli.md (through
// `cello guide`'s copy of it), so the command and the doc can't say different things.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  addAgentsSection,
  AGENTS_END,
  AGENTS_HEADING,
  AGENTS_START,
  agentsBlock,
  agentsFile,
  agentsSection,
  lineDiff,
  withAgentsSection,
} from "./agentsMd.ts"
import { GUIDE } from "./guide.ts"

describe("agentsSection", () => {
  it("is the snippet between docs/cli.md's agents-md markers, unindented, without its fence, with KEY replaced", () => {
    const section = agentsSection(GUIDE, "THAI")
    expect(section.startsWith(`${AGENTS_HEADING}\n\nThis repo's tasks live in Cello, project **THAI** on Lucas's board.`)).toBe(true)
    expect(section).toContain("`cello task claim THAI-n`, then do it.")
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
  const section = `${AGENTS_HEADING}\n\nThis repo's tasks live in Cello, project **THAI** on Lucas's board.\n\nRun \`cello guide\` once.\n- Claim a task first.`
  /** The section as the file holds it: between Cello's markers, the start one carrying the text's fingerprint. */
  const marked = (text: string, eol = "\n") => agentsBlock(text).split("\n").join(eol)

  it("writes the section between markers, the start one with a fingerprint of the text it wrote", () => {
    expect(agentsBlock("## T\n\nText.")).toMatch(/^<!-- cello:agents-md:start sha256:[0-9a-f]{12} -->\n## T\n\nText.\n<!-- cello:agents-md:end -->$/)
    expect(agentsBlock("## T\n\nText.")).not.toBe(agentsBlock("## T\n\nOther text."))
  })

  it("appends the section between its markers after what's there, separated by a blank line", () => {
    expect(withAgentsSection("# Repo\n\nRules.\n", section)).toEqual({
      text: `# Repo\n\nRules.\n\n${marked(section)}\n`,
      change: "added",
      before: null,
      backup: false,
    })
    expect(withAgentsSection("# Repo\n\nRules.", section).text).toBe(`# Repo\n\nRules.\n\n${marked(section)}\n`)
    expect(withAgentsSection("# Repo\n\n", section).text).toBe(`# Repo\n\n${marked(section)}\n`)
    expect(withAgentsSection("", section).text).toBe(`${marked(section)}\n`)
    // A mention in a sentence isn't the heading.
    expect(withAgentsSection("We like Tracking work in Cello.\n", section).change).toBe("added")
  })

  it("between the markers, puts the current text in place of an earlier one Cello wrote, keeping everything around it, with no .bak", () => {
    const old = section.replace("- Claim a task first.", "- Claim before working.")
    const current = `# Repo\n\nRules.\n\n${marked(old)}\n\n## Ours\n\nMore.\n`
    expect(withAgentsSection(current, section)).toEqual({
      text: `# Repo\n\nRules.\n\n${marked(section)}\n\n## Ours\n\nMore.\n`,
      change: "updated",
      before: old,
      backup: false,
    })
  })

  it("keeps a .bak when the text between the markers isn't exactly what Cello wrote: notes added, no fingerprint, another project's key", () => {
    const withNotes = marked(section).replace("- Claim a task first.", "- Claim a task first.\n- Our note: deploys go through Lucas.")
    const unprinted = [AGENTS_START, ...section.replace("first.", "first!").split("\n"), AGENTS_END].join("\n")
    const otherKey = marked(section.replace("**THAI**", "**APP**"))
    for (const current of [withNotes, unprinted, otherKey]) {
      expect(withAgentsSection(`${current}\n`, section), current).toMatchObject({ text: `${marked(section)}\n`, change: "updated", backup: true })
    }
  })

  it("is idempotent: the current text between the markers changes nothing", () => {
    for (const current of ["", "# Repo\n", `# Repo\n\n${AGENTS_HEADING}\n\nRun \`cello context\` first.\n\n## Next\n`]) {
      const once = withAgentsSection(current, section).text
      expect(withAgentsSection(once, section), current).toEqual({ text: once, change: "unchanged", before: section, backup: false })
    }
  })

  it("replaces an old section without markers, Cello's by its words (`cello guide` or `cello context`), keeping a .bak", () => {
    const old = `${AGENTS_HEADING}\n\nThis repo's tasks live in Cello.\n\n- Run \`cello context\` at the start.`
    const current = `# Repo\n\nRules.\n\n${old}\n\n## Ours\n\nMore.\n`
    expect(withAgentsSection(current, section)).toEqual({
      text: `# Repo\n\nRules.\n\n${marked(section)}\n\n## Ours\n\nMore.\n`,
      change: "replaced",
      before: old,
      backup: true,
    })
    // At the end of the file, and spelled another way.
    const last = `# Repo\n\n## Tracking work in Cello (THAI)\n\nRun \`cello guide\`.\n`
    expect(withAgentsSection(last, section)).toEqual({
      text: `# Repo\n\n${marked(section)}\n`,
      change: "replaced",
      before: "## Tracking work in Cello (THAI)\n\nRun `cello guide`.",
      backup: true,
    })
  })

  it("the old section ends at the next heading of any level, a setext heading or a --- rule, so what follows it stays", () => {
    const old = `${AGENTS_HEADING}\n\nRun \`cello context\` first.`
    for (const after of [
      "# Top\n\nKeep.",
      "#### Release notes\n\nKeep.",
      "Release notes\n=============\n\nKeep.",
      "Release notes\n-------------\n\nKeep.",
      "---\n\nKeep.",
      "***\n\nKeep.",
      "_ _ _\n\nKeep.",
    ]) {
      expect(withAgentsSection(`${old}\n\n${after}\n`, section), after).toMatchObject({ text: `${marked(section)}\n\n${after}\n`, before: old })
    }
    // A list item or a line of text isn't a rule.
    const list = `${old}\n- More.\nStill Cello's.`
    expect(withAgentsSection(`${list}\n`, section)).toMatchObject({ text: `${marked(section)}\n`, before: list })
  })

  it("a heading inside a code fence doesn't end the old section", () => {
    const old = `${AGENTS_HEADING}\n\nRun \`cello context\`:\n\n\`\`\`bash\n# a comment\n## not a heading\n---\n\`\`\`\n\nThe end.`
    expect(withAgentsSection(`${old}\n\n## Next\n`, section)).toMatchObject({ text: `${marked(section)}\n\n## Next\n`, before: old })
  })

  it("leaves a Tracking work in Cello section that isn't recognisably Cello's alone, at any level or with words after it", () => {
    for (const heading of [AGENTS_HEADING, "### Tracking work in Cello", "## Tracking work in Cello (THAI)", "##   tracking work in cello  "]) {
      const current = `# Repo\n\n${heading}\n\nOur own words.\n\n## Other\n`
      expect(withAgentsSection(current, section), heading).toEqual({ text: current, change: "foreign", before: null, backup: false })
    }
    // Cello's words further down, in another section, don't make it Cello's.
    const below = `${AGENTS_HEADING}\n\nOurs.\n\n#### Other\n\nRun \`cello guide\`.\n`
    expect(withAgentsSection(below, section).change).toBe("foreign")
  })

  it("uses the file's own line endings", () => {
    const crlfSection = marked(section, "\r\n")
    expect(withAgentsSection("# Repo\r\n\r\nRules.", section).text).toBe(`# Repo\r\n\r\nRules.\r\n\r\n${crlfSection}\r\n`)
    expect(withAgentsSection("# Repo\r\n\r\nRules.\r\n\r\n", section).text).toBe(`# Repo\r\n\r\nRules.\r\n\r\n${crlfSection}\r\n`)
    const old = `# Repo\r\n\r\n${AGENTS_HEADING}\r\n\r\nRun \`cello context\`.\r\n\r\n## Next\r\n`
    const replaced = withAgentsSection(old, section)
    expect(replaced).toMatchObject({ text: `# Repo\r\n\r\n${crlfSection}\r\n\r\n## Next\r\n`, change: "replaced" })
    expect(withAgentsSection(replaced.text, section).change).toBe("unchanged")
  })

  it("refuses markers it can't pair, instead of guessing where the section ends", () => {
    expect(() => withAgentsSection(`${AGENTS_START}\n${section}\n`, section)).toThrow("cello:agents-md")
    expect(() => withAgentsSection(`${AGENTS_END}\n${section}\n${AGENTS_START}\n`, section)).toThrow("cello:agents-md")
  })
})

describe("lineDiff", () => {
  it("lists the lines taken out (-) and put in (+), in order, without the unchanged or blank ones", () => {
    expect(lineDiff("a\nb\n\nc\nd", "a\nB\nc\n\nd\ne")).toEqual(["- b", "+ B", "+ e"])
    expect(lineDiff("same", "same")).toEqual([])
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

  it("an old unmarked section is replaced with a .bak of the file kept; an earlier Cello render is updated in place without one", () => {
    const checkout = fs.mkdtempSync(path.join(base, "co-"))
    const file = path.join(checkout, "AGENTS.md")
    const original = `# Repo\n\n${AGENTS_HEADING}\n\nRun \`cello context\` at the start of each session.\n\n## Ours\n`
    fs.writeFileSync(file, original)
    const replaced = addAgentsSection(checkout, GUIDE, "THAI")
    expect(replaced).toMatchObject({ file, changed: true, change: "replaced", backup: `${file}.bak` })
    expect(replaced.diff).toContain("- Run `cello context` at the start of each session.")
    expect(fs.readFileSync(`${file}.bak`, "utf8")).toBe(original)
    expect(fs.readFileSync(file, "utf8")).toBe(`# Repo\n\n${agentsBlock(agentsSection(GUIDE, "THAI"))}\n\n## Ours\n`)

    expect(addAgentsSection(checkout, GUIDE, "THAI")).toEqual({ file, changed: false, change: "unchanged", backup: null, diff: [] })

    // An older text Cello wrote, untouched since: updated, no new .bak.
    fs.rmSync(`${file}.bak`)
    const older = agentsSection(GUIDE, "THAI").replace("Run `cello context` at the start of each session.", "Run `cello context` first.")
    fs.writeFileSync(file, `# Repo\n\n${agentsBlock(older)}\n\n## Ours\n`)
    expect(addAgentsSection(checkout, GUIDE, "THAI")).toEqual({
      file,
      changed: true,
      change: "updated",
      backup: null,
      diff: ["- - Run `cello context` first.", "+ - Run `cello context` at the start of each session."],
    })
    expect(fs.existsSync(`${file}.bak`)).toBe(false)
  })

  it("notes added between the markers are kept in a .bak, and an earlier .bak is never overwritten (.bak.1, .bak.2)", () => {
    const checkout = fs.mkdtempSync(path.join(base, "co-"))
    const file = path.join(checkout, "AGENTS.md")
    const current = agentsBlock(agentsSection(GUIDE, "THAI"))
    fs.writeFileSync(`${file}.bak`, "an older backup\n")
    const withNote = (note: string) => `${current.replace(AGENTS_END, `- ${note}\n${AGENTS_END}`)}\n`
    fs.writeFileSync(file, withNote("Our note."))
    expect(addAgentsSection(checkout, GUIDE, "THAI")).toMatchObject({ change: "updated", backup: `${file}.bak.1`, diff: ["- - Our note."] })
    expect(fs.readFileSync(`${file}.bak.1`, "utf8")).toBe(withNote("Our note."))
    expect(fs.readFileSync(`${file}.bak`, "utf8")).toBe("an older backup\n")
    expect(fs.readFileSync(file, "utf8")).toBe(`${current}\n`)

    fs.writeFileSync(file, withNote("Another note."))
    expect(addAgentsSection(checkout, GUIDE, "THAI").backup).toBe(`${file}.bak.2`)
    expect(fs.readFileSync(`${file}.bak.1`, "utf8")).toBe(withNote("Our note."))
  })

  it("a symlinked CLAUDE.md stays a link when its section is replaced", () => {
    const checkout = fs.mkdtempSync(path.join(base, "co-"))
    const real = path.join(base, `real-${path.basename(checkout)}.md`)
    fs.writeFileSync(real, `${AGENTS_HEADING}\n\nRun \`cello guide\`.\n`)
    fs.symlinkSync(real, path.join(checkout, "CLAUDE.md"))
    expect(addAgentsSection(checkout, GUIDE, "THAI").change).toBe("replaced")
    expect(fs.lstatSync(path.join(checkout, "CLAUDE.md")).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(real, "utf8")).toBe(`${agentsBlock(agentsSection(GUIDE, "THAI"))}\n`)
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
