import * as fs from "node:fs"
import * as path from "node:path"
import * as Effect from "effect/Effect"
import { describe, expect, it } from "vitest"
import { DOC_PATH, GUIDE_PATH, guideModule, parseHelp, referenceFromCli, renderReference, withReference } from "./reference.ts"

const SUBMIT_HELP = `DESCRIPTION
  Hand finished work to Lucas: a review packet.

USAGE
  cello task submit [flags] <key>

ARGUMENTS
  key string    A task key, e.g. CEL-3.

FLAGS
  --json                   Print JSON for scripts.
  --summary string         What changed, in markdown.

GLOBAL FLAGS
  --help, -h                                                          Show help information
`

describe("parseHelp", () => {
  it("reads the description, usage, arguments and flags, and leaves out the global flags", () => {
    expect(parseHelp(SUBMIT_HELP)).toEqual({
      description: "Hand finished work to Lucas: a review packet.",
      usage: "cello task submit [flags] <key>",
      arguments: [{ name: "key string", description: "A task key, e.g. CEL-3." }],
      flags: [
        { name: "--json", description: "Print JSON for scripts." },
        { name: "--summary string", description: "What changed, in markdown." },
      ],
      subcommands: [],
      globalFlags: [{ name: "--help, -h", description: "Show help information" }],
    })
  })
})

describe("renderReference", () => {
  it("gives every command a heading, its usage and a table of what it takes", () => {
    const page = parseHelp(SUBMIT_HELP)
    const md = renderReference([{ path: ["task", "submit"], page }], page.globalFlags)
    expect(md).toContain("### cello task submit")
    expect(md).toContain("cello task submit [flags] <key>")
    expect(md).toContain("| `key string` | A task key, e.g. CEL-3. |")
    expect(md).toContain("| `--summary string` | What changed, in markdown. |")
  })

  it("says so when an argument or flag has no description, so it gets one", () => {
    const page = parseHelp(SUBMIT_HELP.replace("A task key, e.g. CEL-3.", ""))
    expect(renderReference([{ path: ["task", "submit"], page }], [])).toContain("| `key string` | (no description yet) |")
  })
})

describe("withReference", () => {
  it("replaces only what sits between the markers", () => {
    const doc = "# Title\n\n<!-- cli-reference:start -->\nold\n<!-- cli-reference:end -->\n\nAfter\n"
    expect(withReference(doc, "new")).toBe("# Title\n\n<!-- cli-reference:start -->\nnew\n<!-- cli-reference:end -->\n\nAfter\n")
  })
})

describe("docs/cli.md and cello guide", () => {
  it("match the CLI as it is now (run `bun run docs:cli` after changing a command)", async () => {
    const reference = await Effect.runPromise(referenceFromCli)
    const doc = fs.readFileSync(DOC_PATH, "utf8")
    expect(withReference(doc, reference), "docs/cli.md is out of date: run `bun run docs:cli`").toBe(doc)
    expect(fs.readFileSync(GUIDE_PATH, "utf8"), "apps/cli/src/guide.ts is out of date: run `bun run docs:cli`").toBe(guideModule(doc))
  })

  it("documents a command that runs by itself and has subcommands too: cello backup and cello backup list", async () => {
    const reference = await Effect.runPromise(referenceFromCli)
    expect(reference).toContain("### cello backup\n")
    expect(reference).toContain("### cello backup list\n")
    expect(reference).not.toContain("### cello task\n")
  })

  it("documents every command with a description on each argument and flag", async () => {
    const reference = await Effect.runPromise(referenceFromCli)
    expect(reference).not.toContain("(no description yet)")
    expect(path.basename(DOC_PATH)).toBe("cli.md")
  })
})
