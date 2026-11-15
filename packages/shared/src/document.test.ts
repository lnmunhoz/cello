import { describe, expect, it } from "vitest"
import {
  changedSections,
  isSlug,
  linkTargets,
  localFileTarget,
  mapLinkTargets,
  pagePath,
  pageTarget,
  plainText,
  readerContent,
  referenceDefinitions,
  sectionsOf,
  slugify,
  splitFrontmatter,
  splitSections,
  summaryOf,
  titleFromFileName,
  titleOf,
  uniqueSlug,
} from "./document.ts"

describe("slugs", () => {
  it("turn a title into lowercase words joined by dashes", () => {
    expect(slugify("Billing audit")).toBe("billing-audit")
    expect(slugify("  Q3: Billing — audit!  ")).toBe("q3-billing-audit")
    expect(slugify("Café déjà vu")).toBe("cafe-deja-vu")
    expect(slugify("Lucas's plan")).toBe("lucass-plan")
    expect(slugify("🎉")).toBe("")
    expect(slugify("a".repeat(120))).toHaveLength(80)
  })

  it("are checked, and made unique with a number", () => {
    expect(isSlug("billing-audit")).toBe(true)
    expect(isSlug("Billing audit")).toBe(false)
    expect(isSlug("trailing-")).toBe(false)
    expect(isSlug("")).toBe(false)
    const taken = new Set(["report", "report-2"])
    expect(uniqueSlug("report", (s) => taken.has(s))).toBe("report-3")
    expect(uniqueSlug("fresh", (s) => taken.has(s))).toBe("fresh")
  })

  it("name the reader's URL", () => {
    expect(pagePath("CEL", "billing-audit")).toBe("/CEL/pages/billing-audit")
  })
})

describe("frontmatter, title and summary", () => {
  const doc = [
    "---",
    "title: \"Billing audit\"",
    "summary: What we found in the invoices",
    "---",
    "# Billing audit",
    "",
    "We checked **every** invoice from [Stripe](https://stripe.com).",
    "It took `two` days.",
    "",
    "## Findings",
  ].join("\n")

  it("splits YAML-style frontmatter from the content", () => {
    const { frontmatter, content } = splitFrontmatter(doc)
    expect(frontmatter).toEqual({ title: "Billing audit", summary: "What we found in the invoices" })
    expect(content.startsWith("# Billing audit")).toBe(true)
    expect(splitFrontmatter("No frontmatter\n---\n")).toEqual({ frontmatter: {}, content: "No frontmatter\n---\n" })
    expect(splitFrontmatter("---\nunclosed: yes\n")).toEqual({ frontmatter: {}, content: "---\nunclosed: yes\n" })
  })

  it("takes the title from frontmatter, else the first line's # heading", () => {
    expect(titleOf(doc)).toBe("Billing audit")
    expect(titleOf("# The **bold** plan\n\nText")).toBe("The bold plan")
    expect(titleOf("Intro first\n\n# Not the title")).toBeNull()
    expect(titleFromFileName("/tmp/billing_audit-q3.md")).toBe("Billing audit q3")
  })

  it("summarizes with the frontmatter summary, else the first paragraph as plain text", () => {
    expect(summaryOf(doc)).toBe("What we found in the invoices")
    const plain = doc.replace(/^summary:.*\n/m, "")
    expect(summaryOf(plain)).toBe("We checked every invoice from Stripe. It took two days.")
    expect(summaryOf("# Title\n\n```\ncode\n```\n\n| a |\n| - |\n\n- a list\n\nThe paragraph.")).toBe("The paragraph.")
    expect(summaryOf(`# T\n\n${"word ".repeat(100)}`)).toMatch(/^(word ){50,}word…$/)
    expect(summaryOf(`# T\n\n${"word ".repeat(100)}`).length).toBeLessThanOrEqual(281)
    expect(summaryOf("## Only a heading")).toBe("")
  })

  it("reads without frontmatter and without a first heading that repeats the title", () => {
    expect(readerContent(doc, "Billing audit").startsWith("We checked")).toBe(true)
    expect(readerContent(doc, "Another title").startsWith("# Billing audit")).toBe(true)
  })

  it("strips inline markdown to plain text", () => {
    expect(plainText("**Bold**, *em*, _em_, ~~gone~~, `code`, [link](x.md), ![alt](a.png), snake_case, a\\*b")).toBe(
      "Bold, em, em, gone, code, link, alt, snake_case, a*b",
    )
  })
})

describe("sections", () => {
  const content = [
    "Intro paragraph.",
    "",
    "## What we found",
    "Text one.",
    "",
    "```md",
    "## Not a heading",
    "```",
    "",
    "### Details: `rates`",
    "Text two.",
    "",
    "Setext heading",
    "--------------",
    "Under setext.",
    "",
    "## What we found",
    "Duplicate title.",
    "",
    "## Intro",
    "Clashes with the intro block.",
  ].join("\n")

  it("lists h2 and h3 headings outside code, with unique ids for the TOC", () => {
    expect(sectionsOf(content)).toEqual([
      { id: "what-we-found", level: 2, title: "What we found" },
      { id: "details-rates", level: 3, title: "Details: rates" },
      { id: "setext-heading", level: 2, title: "Setext heading" },
      { id: "what-we-found-2", level: 2, title: "What we found" },
      { id: "intro-2", level: 2, title: "Intro" },
    ])
  })

  it("splits the content into blocks, one per section plus the intro", () => {
    const blocks = splitSections(content)
    expect(blocks.map((b) => b.id)).toEqual(["intro", "what-we-found", "details-rates", "setext-heading", "what-we-found-2", "intro-2"])
    expect(blocks[0]!.markdown).toBe("Intro paragraph.")
    expect(blocks[1]!.markdown).toBe("## What we found\nText one.\n\n```md\n## Not a heading\n```")
    expect(blocks[3]!.markdown).toBe("Setext heading\n--------------\nUnder setext.")
    // The blocks put back together are the content.
    expect(blocks.map((b) => b.markdown).join("\n\n")).toBe(content.replace(/\n\n+/g, "\n\n"))
    expect(splitSections("## Only\n\nbody").map((b) => b.id)).toEqual(["only"])
  })

  it("finds the sections a new version changed or added", () => {
    const before = "Intro.\n\n## One\nSame.\n\n## Two\nOld text.\n"
    const after = "Intro.\n\n## One\nSame.  \n\n## Two\nNew text.\n\n## Three\nAdded.\n"
    expect(changedSections(before, after)).toEqual(["two", "three"])
    expect(changedSections(after, after)).toEqual([])
    expect(changedSections("Intro.", "Intro changed.")).toEqual(["intro"])
  })

  it("collects link reference definitions, so each section can resolve them", () => {
    expect(referenceDefinitions("See [the PR][pr].\n\n```\n[x]: not.md\n```\n\n[pr]: https://github.com/x/y/pull/1\n")).toEqual([
      "[pr]: https://github.com/x/y/pull/1",
    ])
  })
})

describe("link targets", () => {
  const md = [
    "![Board](shots/board.png \"The board\") and [the log](./vitest.log).",
    "`![in code](skip.png)` and ``![also](skip.png)``",
    "[![thumb](thumb.png)](full.png)",
    "![spaced](<my chart.png>)",
    "",
    "```",
    "![fenced](skip.png)",
    "```",
    "",
    "[ref]: diagram.png",
    "Links elsewhere: [web](https://example.com) and [anchor](#findings).",
  ].join("\n")

  it("lists every link and image outside code, with images marked", () => {
    expect(linkTargets(md)).toEqual([
      { target: "shots/board.png", image: true },
      { target: "./vitest.log", image: false },
      { target: "thumb.png", image: true },
      { target: "full.png", image: false },
      { target: "my chart.png", image: true },
      { target: "diagram.png", image: false },
      { target: "https://example.com", image: false },
      { target: "#findings", image: false },
    ])
  })

  it("rewrites the targets a mapping knows, and leaves the rest alone", () => {
    const urls: Record<string, string> = {
      "shots/board.png": "/attachments/A1",
      "thumb.png": "/attachments/A2",
      "full.png": "/attachments/A3",
      "my chart.png": "/attachments/A4",
      "diagram.png": "/attachments/A5",
    }
    const out = mapLinkTargets(md, ({ target }) => urls[target] ?? null)
    expect(out.split("\n")).toEqual([
      "![Board](/attachments/A1 \"The board\") and [the log](./vitest.log).",
      "`![in code](skip.png)` and ``![also](skip.png)``",
      "[![thumb](/attachments/A2)](/attachments/A3)",
      "![spaced](</attachments/A4>)",
      "",
      "```",
      "![fenced](skip.png)",
      "```",
      "",
      "[ref]: /attachments/A5",
      "Links elsewhere: [web](https://example.com) and [anchor](#findings).",
    ])
    expect(mapLinkTargets(md, () => null)).toBe(md)
  })

  it("decodes percent-escapes in targets", () => {
    expect(linkTargets("![x](my%20chart.png)")).toEqual([{ target: "my chart.png", image: true }])
  })
})

describe("what a page's link points at", () => {
  const files = [
    { id: "01VIDEO", kind: "video" as const },
    { id: "01LOG", kind: "file" as const },
  ]

  it("a file the page carries, by its stored URL", () => {
    expect(pageTarget("/attachments/01VIDEO", files)).toEqual({ kind: "file", file: files[0] })
    expect(pageTarget("/attachments/01LOG#L2", files)).toEqual({ kind: "file", file: files[1] })
  })

  it("a local file that never went up with the page is missing (CEL-54)", () => {
    expect(pageTarget("a-palette-typing.mp4", files)).toEqual({ kind: "missing", path: "a-palette-typing.mp4" })
    expect(pageTarget("../shots/board.png?x=1", files)).toEqual({ kind: "missing", path: "../shots/board.png" })
  })

  it("anything else is a plain link", () => {
    for (const href of ["https://example.com/a.mp4", "/attachments/01OTHER", "#findings", "/CEL/issues", undefined]) {
      expect(pageTarget(href, files), String(href)).toEqual({ kind: "link" })
    }
  })
})

describe("local file targets", () => {
  it("is the file path a link points at, without its query or anchor", () => {
    expect(localFileTarget("a-palette-typing.mp4")).toBe("a-palette-typing.mp4")
    expect(localFileTarget("./shots/board.png#top")).toBe("./shots/board.png")
    expect(localFileTarget("../logs/vitest.log?raw")).toBe("../logs/vitest.log")
    expect(localFileTarget("/tmp/cello/report.md")).toBe("/tmp/cello/report.md")
    expect(localFileTarget("my chart.png")).toBe("my chart.png")
  })

  it("is null for web addresses, anchors, stored files and paths without a file extension", () => {
    for (const target of [
      "https://example.com/a.mp4",
      "//cdn.example.com/a.png",
      "mailto:lucas@example.com",
      "#findings",
      "?version=2",
      "",
      "/attachments/01ABC",
      "/CEL/issues",
      "other-page",
      "shots/",
      ".env",
    ]) {
      expect(localFileTarget(target), target).toBeNull()
    }
  })
})
