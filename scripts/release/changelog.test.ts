// The changelog a release writes: main's own history since the last tag, grouped into Features, Fixes and
// Other changes, with tasks landing as `merge: … (CEL-n)` commits.
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  CHANGELOG_HEADER,
  type Commit,
  entriesOf,
  notesOf,
  latestTag,
  parseSubject,
  prependSection,
  readCommits,
  renderNotes,
  renderSection,
  repoUrlOf,
} from "./changelog.ts"

const REPO = "https://github.com/lnmunhoz/cello"
const sha = (n: number) => String(n).padStart(40, "a")
const commit = (n: number, subject: string, branch?: string[]): Commit => ({
  sha: sha(n),
  date: "2026-11-16",
  subject,
  ...(branch ? { branch } : {}),
})
const link = (n: number) => `([${sha(n).slice(0, 7)}](${REPO}/commit/${sha(n)}))`

describe("parseSubject", () => {
  it("reads a conventional subject's type, scope, breaking mark and description", () => {
    expect(parseSubject("feat(web): the reload bar (CEL-37)")).toEqual({
      type: "feat",
      scope: "web",
      breaking: false,
      description: "the reload bar (CEL-37)",
    })
    expect(parseSubject("merge: cello wait rides out a restart (CEL-78)")).toEqual({
      type: "merge",
      scope: null,
      breaking: false,
      description: "cello wait rides out a restart (CEL-78)",
    })
    expect(parseSubject("fix(cli,desktop)!: service install never replaces another service")).toMatchObject({
      type: "fix",
      scope: "cli,desktop",
      breaking: true,
    })
  })

  it("returns null for a subject that isn't conventional", () => {
    expect(parseSubject("Merge branch 'main' into worktree-agent-acb3")).toBeNull()
    expect(parseSubject("Native app")).toBeNull()
  })
})

describe("entriesOf", () => {
  it("files a merged task by what its branch brought: a feat makes it a feature", () => {
    const merge = commit(1, "merge: the Agents page shows an agent's live log (CEL-106)", [
      "fix: review findings on the live log (CEL-106)",
      "feat(web): the Agents page shows an agent's live log (CEL-106)",
      "Merge branch 'main' into worktree-agent-acb3",
    ])
    expect(entriesOf([merge])).toEqual([
      { section: "Features", text: "the Agents page shows an agent's live log (CEL-106)", sha: sha(1) },
    ])
  })

  it("files a merge that only brought fixes under Fixes, and one with neither under Other changes", () => {
    const fixes = commit(1, "merge: service install --replace checks the listener (CEL-81)", [
      "fix(cli): service install --replace also checks the lock's pid (CEL-81)",
      "test(cli): the listener check (CEL-81)",
    ])
    const other = commit(2, "merge: the setup video remade as an explainer (CEL-94)", [
      "art(setup-video): render the v2 video (CEL-94)",
      "docs: the video's script (CEL-94)",
    ])
    expect(entriesOf([fixes, other]).map((e) => [e.section, e.text])).toEqual([
      ["Fixes", "service install --replace checks the listener (CEL-81)"],
      ["Other changes", "the setup video remade as an explainer (CEL-94)"],
    ])
  })

  it("files direct commits by type, the scope in bold, and keeps the subject's words, CEL keys included", () => {
    const entries = entriesOf([
      commit(1, "feat: Cello app icon and its spec"),
      commit(2, "fix(ask): a text-only question is optional (CEL-116)"),
      commit(3, "docs(readme): the setup video at the top (CEL-109)"),
      commit(4, "ci: free security checks (CEL-99)"),
      commit(5, "Initial import"),
    ])
    expect(entries.map((e) => [e.section, e.text])).toEqual([
      ["Features", "Cello app icon and its spec"],
      ["Fixes", "**ask:** a text-only question is optional (CEL-116)"],
      ["Other changes", "**readme:** the setup video at the top (CEL-109)"],
      ["Other changes", "free security checks (CEL-99)"],
      ["Other changes", "Initial import"],
    ])
  })

  it("marks a breaking change", () => {
    expect(entriesOf([commit(1, "feat(server)!: a new event format (CEL-200)")])[0]!.text).toBe(
      "**server:** **Breaking:** a new event format (CEL-200)",
    )
  })

  it("leaves out release commits and merges of main into a branch", () => {
    expect(
      entriesOf([
        commit(1, "chore(release): v0.3.0"),
        commit(2, "Merge branch 'main' into worktree-agent-acb3"),
        commit(3, "merge: main into CEL-92"),
        commit(4, "Merge pull request #3 from lnmunhoz/x"),
      ]),
    ).toEqual([])
  })
})

describe("renderSection", () => {
  const entries = entriesOf([
    commit(1, "merge: cello wait rides out a restart (CEL-78)", ["feat(cli): wait (CEL-78)"]),
    commit(2, "fix(web): Display stays whole when the panel is wide (CEL-49)"),
    commit(3, "docs: how a feature is built"),
  ])

  it("heads a release with its version, compare link and date, then Features, Fixes and Other changes", () => {
    expect(renderSection({ version: "0.3.1", date: "2026-11-17", previousTag: "v0.3.0", repoUrl: REPO, entries })).toBe(
      [
        `## [0.3.1](${REPO}/compare/v0.3.0...v0.3.1) (2026-11-17)`,
        "",
        "### Features",
        "",
        `- cello wait rides out a restart (CEL-78) ${link(1)}`,
        "",
        "### Fixes",
        "",
        `- **web:** Display stays whole when the panel is wide (CEL-49) ${link(2)}`,
        "",
        "### Other changes",
        "",
        `- how a feature is built ${link(3)}`,
        "",
      ].join("\n"),
    )
  })

  it("leaves out empty groups", () => {
    const onlyFix = entriesOf([commit(2, "fix(web): Display stays whole (CEL-49)")])
    const text = renderSection({ version: "0.3.2", date: "2026-11-17", previousTag: "v0.3.1", repoUrl: REPO, entries: onlyFix })
    expect(text).not.toContain("### Features")
    expect(text).not.toContain("### Other changes")
    expect(text).toContain("### Fixes")
  })

  it("introduces the first tagged release with where its history starts", () => {
    const text = renderSection({
      version: "0.3.0",
      date: "2026-11-16",
      previousTag: null,
      firstCommitDate: "2026-11-14",
      repoUrl: REPO,
      entries,
    })
    expect(text.split("\n").slice(0, 4)).toEqual([
      "## 0.3.0 (2026-11-16)",
      "",
      "First tagged release: everything on main since the first commit (2026-11-14). Earlier builds called themselves 0.1.0 or 0.2.0 and weren't tagged.",
      "",
    ])
  })

  it("the GitHub release notes are the section without its heading", () => {
    const notes = renderNotes({ version: "0.3.1", date: "2026-11-17", previousTag: "v0.3.0", repoUrl: REPO, entries })
    expect(notes.startsWith("### Features\n")).toBe(true)
    expect(notes).not.toContain("## [0.3.1]")
  })
})

describe("prependSection", () => {
  const section = (v: string) => `## [${v}](${REPO}/compare/a...b) (2026-11-17)\n\n### Fixes\n\n- x\n`

  it("starts CHANGELOG.md with its header when there's none", () => {
    expect(prependSection(null, section("0.3.0"), "0.3.0")).toBe(`${CHANGELOG_HEADER}\n${section("0.3.0")}`)
  })

  it("puts the new section above the earlier ones, under the header", () => {
    const before = `${CHANGELOG_HEADER}\n${section("0.3.0")}`
    expect(prependSection(before, section("0.3.1"), "0.3.1")).toBe(`${CHANGELOG_HEADER}\n${section("0.3.1")}\n${section("0.3.0")}`)
  })

  it("refuses a version that already has a section", () => {
    const before = `${CHANGELOG_HEADER}\n${section("0.3.0")}`
    expect(() => prependSection(before, section("0.3.0"), "0.3.0")).toThrow(/already has a 0.3.0 section/)
    expect(() => prependSection(`${CHANGELOG_HEADER}\n## 0.3.0 (2026-11-16)\n`, section("0.3.0"), "0.3.0")).toThrow(/already/)
  })
})

describe("notesOf", () => {
  const changelog = `${CHANGELOG_HEADER}\n## [0.3.1](${REPO}/compare/v0.3.0...v0.3.1) (2026-11-17)\n\n### Fixes\n\n- b\n\n## 0.3.0 (2026-11-16)\n\nFirst.\n\n### Features\n\n- a\n`

  it("reads a release's notes back out of CHANGELOG.md, for a GitHub release made by hand", () => {
    expect(notesOf(changelog, "0.3.1")).toBe("### Fixes\n\n- b\n")
    expect(notesOf(changelog, "0.3.0")).toBe("First.\n\n### Features\n\n- a\n")
  })

  it("refuses a version it has no section for", () => {
    expect(() => notesOf(changelog, "0.2.0")).toThrow(/no 0.2.0 section/)
  })
})

describe("repoUrlOf", () => {
  it("turns a GitHub remote into the repository's web address", () => {
    expect(repoUrlOf("git@github.com:lnmunhoz/cello.git")).toBe(REPO)
    expect(repoUrlOf("https://github.com/lnmunhoz/cello.git")).toBe(REPO)
    expect(repoUrlOf("https://github.com/lnmunhoz/cello")).toBe(REPO)
    expect(repoUrlOf("ssh://git@github.com/lnmunhoz/cello.git")).toBe(REPO)
  })
})

describe("reading main's history from git", () => {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-release-changelog-")))
  afterAll(() => fs.rmSync(base, { recursive: true, force: true }))
  const git = (...args: string[]) => {
    const result = spawnSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd: base, encoding: "utf8" })
    if (result.status !== 0) throw new Error(result.stderr)
    return result.stdout.trim()
  }
  const empty = (message: string) => git("commit", "-q", "--allow-empty", "-m", message)

  git("init", "-q", "-b", "main")
  empty("feat: M1 foundation")
  git("tag", "-a", "v0.3.0", "-m", "Cello v0.3.0")
  empty("docs: a guide")
  git("checkout", "-q", "-b", "cel-5")
  empty("feat(web): the reload bar (CEL-5)")
  empty("fix(web): review findings (CEL-5)")
  git("checkout", "-q", "main")
  empty("fix(cli): a direct fix")
  git("merge", "-q", "--no-ff", "cel-5", "-m", "merge: the reload bar (CEL-5)")

  it("finds the latest v-tag", () => {
    expect(latestTag(base)).toBe("v0.3.0")
  })

  it("reads only main's own commits since the tag, newest first, a merge carrying its branch's subjects", () => {
    const commits = readCommits(base, "v0.3.0")
    expect(commits.map((c) => c.subject)).toEqual(["merge: the reload bar (CEL-5)", "fix(cli): a direct fix", "docs: a guide"])
    expect(commits[0]!.branch).toEqual(["fix(web): review findings (CEL-5)", "feat(web): the reload bar (CEL-5)"])
    expect(commits[1]!.branch).toBeUndefined()
    expect(entriesOf(commits).map((e) => e.section)).toEqual(["Features", "Fixes", "Other changes"])
  })

  it("reads the whole history when there's no tag yet", () => {
    expect(readCommits(base, null).map((c) => c.subject).at(-1)).toBe("feat: M1 foundation")
  })
})
