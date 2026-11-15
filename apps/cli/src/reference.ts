// The command reference at the end of docs/cli.md, rendered from every command's own --help, and
// `cello guide`'s text (apps/cli/src/guide.ts), copied from docs/cli.md. `bun run docs:cli` writes
// both; reference.test.ts fails when either has drifted from the CLI.
import * as path from "node:path"
import * as BunServices from "@effect/platform-bun/BunServices"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"
import { CliEnv, run } from "./cli.ts"

const ROOT = path.resolve(import.meta.dirname, "../../..")
export const DOC_PATH = path.join(ROOT, "docs/cli.md")
export const GUIDE_PATH = path.join(ROOT, "apps/cli/src/guide.ts")

const START = "<!-- cli-reference:start -->"
const END = "<!-- cli-reference:end -->"

export interface Row {
  readonly name: string
  readonly description: string
}

export interface HelpPage {
  readonly description: string
  readonly usage: string
  readonly arguments: ReadonlyArray<Row>
  readonly flags: ReadonlyArray<Row>
  readonly subcommands: ReadonlyArray<Row>
  readonly globalFlags: ReadonlyArray<Row>
}

/** One command's help text, split into its sections. */
export const parseHelp = (text: string): HelpPage => {
  const sections = new Map<string, string[]>()
  let current: string[] | null = null
  for (const line of text.split("\n")) {
    if (/^[A-Z][A-Z ]+$/.test(line.trim()) && !line.startsWith(" ")) {
      current = []
      sections.set(line.trim(), current)
    } else if (current && line.trim() !== "") {
      current.push(line.trim())
    }
  }
  const rows = (name: string): Row[] =>
    (sections.get(name) ?? []).map((line) => {
      const [first, ...rest] = line.split(/\s{2,}/)
      return { name: first!, description: rest.join(" ").trim() }
    })
  return {
    description: (sections.get("DESCRIPTION") ?? []).join(" "),
    usage: (sections.get("USAGE") ?? []).join(" "),
    arguments: rows("ARGUMENTS"),
    flags: rows("FLAGS"),
    subcommands: rows("SUBCOMMANDS"),
    globalFlags: rows("GLOBAL FLAGS"),
  }
}

/** What `cello <args> --help` prints, run in this process. */
export const helpFor = (args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const lines: string[] = []
    const capture: Console.Console = Object.assign(Object.create(globalThis.console), {
      log: (...parts: ReadonlyArray<unknown>) => lines.push(parts.join(" ")),
      error: (...parts: ReadonlyArray<unknown>) => lines.push(parts.join(" ")),
    })
    yield* run([...args, "--help"]).pipe(
      Effect.provideService(CliEnv, { env: {}, cwd: ROOT, now: () => 0, readStdin: () => Promise.resolve(""), web: () => undefined }),
      Effect.provideService(Console.Console, capture),
      Effect.provide(BunServices.layer),
      Effect.ignore,
    )
    return lines.join("\n")
  })

export interface CommandPage {
  readonly path: ReadonlyArray<string>
  readonly page: HelpPage
}

/** Every command that does something (the leaves of the tree), in the order `cello --help` lists them. */
export const commandPages = Effect.gen(function* () {
  const root = parseHelp(yield* helpFor([]))
  const pages: CommandPage[] = []
  const walk = (prefix: ReadonlyArray<string>, names: ReadonlyArray<string>): Effect.Effect<void> =>
    Effect.forEach(names, (name) =>
      Effect.gen(function* () {
        const commandPath = [...prefix, name]
        const page = parseHelp(yield* helpFor(commandPath))
        if (page.subcommands.length > 0) return yield* walk(commandPath, page.subcommands.map((s) => s.name))
        pages.push({ path: commandPath, page })
      }), { discard: true })
  yield* walk([], root.subcommands.map((s) => s.name))
  return { pages, globalFlags: root.globalFlags }
})

const cell = (text: string) => text.replaceAll("|", "\\|")

const table = (rows: ReadonlyArray<Row>) =>
  ["| | |", "| --- | --- |", ...rows.map((r) => `| \`${cell(r.name)}\` | ${cell(r.description) || "(no description yet)"} |`)].join("\n")

/** The reference section's markdown: one heading per command with its usage, arguments and flags. */
export const renderReference = (pages: ReadonlyArray<CommandPage>, globalFlags: ReadonlyArray<Row>): string => {
  const parts = [
    "Generated from the CLI's own `--help` by `bun run docs:cli`. Don't edit it by hand: change the command's descriptions in `apps/cli/src/cli.ts` and run that.",
  ]
  for (const { path: commandPath, page } of pages) {
    parts.push(`### cello ${commandPath.join(" ")}`, page.description, "```\n" + page.usage + "\n```")
    const rows = [...page.arguments, ...page.flags]
    if (rows.length > 0) parts.push(table(rows))
  }
  if (globalFlags.length > 0) parts.push("### Flags every command takes", table(globalFlags))
  return parts.join("\n\n")
}

export const referenceFromCli = Effect.map(commandPages, ({ pages, globalFlags }) => renderReference(pages, globalFlags))

/** The doc with its reference section replaced by `reference`. */
export const withReference = (doc: string, reference: string): string => {
  const start = doc.indexOf(START)
  const end = doc.indexOf(END)
  if (start === -1 || end === -1 || end < start) throw new Error(`docs/cli.md needs the ${START} and ${END} markers`)
  return `${doc.slice(0, start + START.length)}\n${reference}\n${doc.slice(end)}`
}

/** guide.ts: `cello guide` prints docs/cli.md, so it reads the same in any repository. */
export const guideModule = (doc: string): string => {
  const escaped = doc.replaceAll("\\", "\\\\").replaceAll("`", "\\`").replaceAll("${", "\\${")
  return [
    "// Generated from docs/cli.md by `bun run docs:cli`; edit docs/cli.md, not this file.",
    "// `cello guide` prints it, so agents in any repository read the same reference.",
    `export const GUIDE = \`${escaped}\``,
    "",
  ].join("\n")
}
