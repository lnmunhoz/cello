// `cello task submit` evidence from the raw arguments: --attach and --link in the order given, each
// --caption describing the one right before it. The flag parser collects repeated flags but forgets
// their order, so this reads the arguments itself. File paths become absolute (the server copies
// them from this machine).
import * as path from "node:path"
import type { EvidenceFile, EvidenceLink } from "@cello/contract/rpcs"

/** `submit`'s flags that take a value; their values are skipped so a value is never read as a flag. */
const VALUE_FLAGS = new Set(["summary", "summary-file", "step", "attach", "link", "caption"])

export type Evidence = { readonly files: EvidenceFile[]; readonly links: EvidenceLink[] } | { readonly error: string }

export const evidenceFromArgs = (args: ReadonlyArray<string>, cwd: string): Evidence => {
  const items: Array<{ kind: "file" | "link"; value: string; caption?: string }> = []
  for (let i = 0; i < args.length; i++) {
    const token = args[i]!
    if (!token.startsWith("--")) continue
    const eq = token.indexOf("=")
    const name = token.slice(2, eq === -1 ? undefined : eq)
    if (!VALUE_FLAGS.has(name)) continue
    const value = eq === -1 ? args[++i] : token.slice(eq + 1)
    if (value === undefined) return { error: `--${name} needs a value.` }
    if (name === "attach") items.push({ kind: "file", value })
    else if (name === "link") items.push({ kind: "link", value })
    else if (name === "caption") {
      const last = items.at(-1)
      if (!last) return { error: "--caption describes the --attach or --link before it; put it after one." }
      if (last.caption !== undefined) {
        return { error: `${last.value} already has a caption; give each --${last.kind === "file" ? "attach" : "link"} one --caption.` }
      }
      last.caption = value
    }
  }
  const caption = (item: { caption?: string }) => (item.caption === undefined ? {} : { caption: item.caption })
  return {
    files: items.filter((i) => i.kind === "file").map((i) => ({ path: path.resolve(cwd, i.value), ...caption(i) })),
    links: items.filter((i) => i.kind === "link").map((i) => ({ url: i.value, ...caption(i) })),
  }
}
