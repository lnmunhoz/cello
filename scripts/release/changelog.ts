// The changelog a release writes (CEL-36), from main's own history since the previous tag: tasks land on
// main as `merge: <what> (CEL-n)` commits, and small changes as direct conventional commits. Reading only
// main's first parents keeps a task to one line (its merge) instead of every commit on its branch; a merge
// is filed by what its branch brought (any feat: Features, else any fix: Fixes, else Other changes). Entries
// keep the subject's words as written (lower case, CEL keys and command names intact).
//
//   bun scripts/release/changelog.ts notes                  the GitHub release notes since the last tag
//   bun scripts/release/changelog.ts section <version>      the CHANGELOG.md section, printed
//   bun scripts/release/changelog.ts write <version>        the section, added to the top of CHANGELOG.md
//   bun scripts/release/changelog.ts notes-of <version>     a written release's notes, read back from CHANGELOG.md
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

export type Commit = {
  readonly sha: string
  readonly date: string
  readonly subject: string
  /** For a merge: the subjects of the commits its branch brought, newest first. */
  readonly branch?: ReadonlyArray<string>
}

export type Section = "Features" | "Fixes" | "Other changes"
export const SECTIONS: ReadonlyArray<Section> = ["Features", "Fixes", "Other changes"]

export type Entry = { readonly section: Section; readonly text: string; readonly sha: string }

export type Subject = { type: string; scope: string | null; breaking: boolean; description: string }

const CONVENTIONAL = /^(\w[\w-]*)(?:\(([^)]*)\))?(!)?: (.+)$/

export const parseSubject = (subject: string): Subject | null => {
  const match = CONVENTIONAL.exec(subject.trim())
  if (!match) return null
  return { type: match[1]!.toLowerCase(), scope: match[2] ?? null, breaking: match[3] === "!", description: match[4]! }
}

// Not changes: the release commits themselves, and merges that only bring main into a branch.
const SKIP = [/^chore\(release\)/, /^Merge (branch|pull request|remote-tracking branch)\b/, /^merge: (origin\/)?main into /i]

const sectionOfType = (type: string | undefined): Section =>
  type === "feat" ? "Features" : type === "fix" ? "Fixes" : "Other changes"

const sectionOfBranch = (subjects: ReadonlyArray<string>): Section => {
  const types = new Set(subjects.map((s) => parseSubject(s)?.type))
  return types.has("feat") ? "Features" : types.has("fix") ? "Fixes" : "Other changes"
}

const entryOf = (commit: Commit): Entry | null => {
  if (SKIP.some((re) => re.test(commit.subject))) return null
  const parsed = parseSubject(commit.subject)
  if (!parsed) return { section: commit.branch ? sectionOfBranch(commit.branch) : "Other changes", text: commit.subject, sha: commit.sha }
  const isMerge = parsed.type === "merge"
  const section = isMerge ? sectionOfBranch(commit.branch ?? []) : sectionOfType(parsed.type)
  const scope = parsed.scope && !isMerge ? `**${parsed.scope}:** ` : ""
  const breaking = parsed.breaking ? "**Breaking:** " : ""
  return { section, text: `${scope}${breaking}${parsed.description}`, sha: commit.sha }
}

/** Main's commits as changelog entries, in history order (newest first); commits that aren't changes dropped. */
export const entriesOf = (commits: ReadonlyArray<Commit>): Entry[] =>
  commits.flatMap((commit) => {
    const entry = entryOf(commit)
    return entry ? [entry] : []
  })

export type Release = {
  readonly version: string
  readonly date: string
  /** The tag this release follows, or null for the first tagged release. */
  readonly previousTag: string | null
  /** For the first release: the date of the first commit, where its history starts. */
  readonly firstCommitDate?: string
  readonly repoUrl: string
  readonly entries: ReadonlyArray<Entry>
}

/** The release's notes without a heading: the GitHub release's body, and the CHANGELOG.md section's body. */
export const renderNotes = (release: Release): string => {
  const lines: string[] = []
  if (release.previousTag === null) {
    const since = release.firstCommitDate ? ` (${release.firstCommitDate})` : ""
    lines.push(
      `First tagged release: everything on main since the first commit${since}. Earlier builds called themselves 0.1.0 or 0.2.0 and weren't tagged.`,
      "",
    )
  }
  for (const section of SECTIONS) {
    const entries = release.entries.filter((e) => e.section === section)
    if (entries.length === 0) continue
    lines.push(`### ${section}`, "")
    for (const e of entries) lines.push(`- ${e.text} ([${e.sha.slice(0, 7)}](${release.repoUrl}/commit/${e.sha}))`)
    lines.push("")
  }
  if (release.entries.length === 0) lines.push("No changes.", "")
  return lines.join("\n")
}

/** The CHANGELOG.md section: a heading with the version (linked to the compare view), the date, then the notes. */
export const renderSection = (release: Release): string => {
  const tag = `v${release.version}`
  const title = release.previousTag
    ? `[${release.version}](${release.repoUrl}/compare/${release.previousTag}...${tag})`
    : release.version
  return `## ${title} (${release.date})\n\n${renderNotes(release)}`
}

export const CHANGELOG_HEADER = [
  "# Changelog",
  "",
  "Every release of Cello, newest first. `bun run release` writes each section from main's commits since the",
  "previous tag; how releases work is in [docs/releases.md](docs/releases.md).",
  "",
].join("\n")

// A release's heading in CHANGELOG.md: `## [0.3.1](…compare…) (date)` or, for the first, `## 0.3.0 (date)`.
const sectionHeading = (version: string) => new RegExp(`^## \\[?${version.replace(/\./g, "\\.")}[\\] ].*$`, "m")

/** CHANGELOG.md with `section` added above the earlier releases; refuses a version it already has. */
export const prependSection = (existing: string | null, section: string, version: string): string => {
  const current = existing ?? CHANGELOG_HEADER
  if (sectionHeading(version).test(current)) throw new Error(`CHANGELOG.md already has a ${version} section.`)
  const first = current.search(/^## /m)
  if (first === -1) return `${current.replace(/\n*$/, "\n")}\n${section}`
  return `${current.slice(0, first)}${section}\n${current.slice(first)}`
}

/** A release's notes (its section without the heading), read back from CHANGELOG.md. */
export const notesOf = (changelog: string, version: string): string => {
  const heading = sectionHeading(version).exec(changelog)
  if (!heading) throw new Error(`CHANGELOG.md has no ${version} section.`)
  const rest = changelog.slice(heading.index + heading[0].length).replace(/^\n+/, "")
  const next = rest.search(/^## /m)
  return (next === -1 ? rest : rest.slice(0, next)).replace(/\n+$/, "\n")
}

/** The web address of a GitHub remote (`git@github.com:o/r.git`, `https://github.com/o/r.git`, `ssh://…`). */
export const repoUrlOf = (remote: string): string => {
  const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(remote.trim())
  if (!match) throw new Error(`Not a GitHub remote: ${remote}`)
  return `https://github.com/${match[1]}/${match[2]}`
}

// ---- reading git ----

const git = (cwd: string, args: string[]): string => {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`)
  return result.stdout
}

/** The newest release tag (`v1.2.3`) reachable from HEAD, or null before the first release. */
export const latestTag = (cwd: string): string | null => {
  const result = spawnSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"], { cwd, encoding: "utf8" })
  return result.status === 0 ? result.stdout.trim() || null : null
}

const FIELD = "\x1f"
const RECORD = "\x1e"

/** Main's own commits (first parents) since `from` (a tag), or the whole history; each merge with its branch's subjects. */
export const readCommits = (cwd: string, from: string | null): Commit[] => {
  const range = from ? `${from}..HEAD` : "HEAD"
  const log = git(cwd, ["log", "--first-parent", `--format=%H${FIELD}%P${FIELD}%ad${FIELD}%s${RECORD}`, "--date=short", range])
  return log
    .split(RECORD)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [sha, parents, date, subject] = record.split(FIELD) as [string, string, string, string]
      const [first, second] = parents.split(" ")
      if (!second) return { sha, date, subject }
      const branch = git(cwd, ["log", "--format=%s", `${first}..${second}`]).split("\n").filter(Boolean)
      return { sha, date, subject, branch }
    })
}

/** The date of the repository's first commit. */
export const firstCommitDate = (cwd: string): string =>
  git(cwd, ["log", "--reverse", "--max-parents=0", "--format=%ad", "--date=short", "HEAD"]).split("\n")[0]!.trim()

export const originUrl = (cwd: string): string => repoUrlOf(git(cwd, ["remote", "get-url", "origin"]))

const today = () => new Date().toISOString().slice(0, 10)

/** The release `version` would make from `cwd`'s history right now. */
export const releaseOf = (cwd: string, version: string, date = today()): Release => {
  const previousTag = latestTag(cwd)
  return {
    version,
    date,
    previousTag,
    ...(previousTag ? {} : { firstCommitDate: firstCommitDate(cwd) }),
    repoUrl: originUrl(cwd),
    entries: entriesOf(readCommits(cwd, previousTag)),
  }
}

/** Adds `version`'s section to the top of `<root>/CHANGELOG.md`; returns the section. */
export const writeChangelog = (root: string, version: string): string => {
  const file = path.join(root, "CHANGELOG.md")
  const section = renderSection(releaseOf(root, version))
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null
  fs.writeFileSync(file, prependSection(existing, section, version))
  return section
}

if (import.meta.main) {
  const root = path.join(import.meta.dirname, "../..")
  const [command, version] = process.argv.slice(2)
  if (command === "notes") process.stdout.write(renderNotes(releaseOf(root, version ?? "next")))
  else if (command === "section" && version) process.stdout.write(renderSection(releaseOf(root, version)))
  else if (command === "write" && version) process.stdout.write(writeChangelog(root, version))
  else if (command === "notes-of" && version) process.stdout.write(notesOf(fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8"), version))
  else {
    console.error("Usage: bun scripts/release/changelog.ts notes | section <version> | write <version> | notes-of <version>")
    process.exit(2)
  }
}
