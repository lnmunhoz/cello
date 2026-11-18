// CEL-41: `cello init` makes the git repo it runs in a Cello project, against a real server and temp
// repos: the main checkout's path (also from a linked worktree), a name from the folder and a free key
// unless given, nothing changed when the repo is already linked. --hooks installs the Claude Code hooks
// (temp HOME, never the real ~/.claude); --agents-md appends docs/cli.md's section between markers and
// brings it up to date on later runs, an old unmarked Cello section included (CEL-61).
import * as fs from "node:fs"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { AGENTS_END, agentsBlock, agentsSection } from "../../src/agentsMd.ts"
import { GUIDE } from "../../src/guide.ts"
import { cello, gitRepo } from "./cli.ts"

/** docs/cli.md's section for project `key`, between the markers it sits in in a repo's file. */
const marked = (key: string) => agentsBlock(agentsSection(GUIDE, key))

const SESSION = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const claude = { CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_PID: String(process.pid) }

const git = (cwd: string, ...args: string[]) => {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  if (result.exitCode !== 0) throw new Error(result.stderr.toString())
}

/** A server with nothing in it but its first workspace, a temp HOME, and a fake `cello` on PATH for the hooks. */
const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const human = yield* connect(port)
  const home = path.join(dataDir, "home")
  const bin = path.join(dataDir, "bin")
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, "cello"), "#!/bin/sh\n", { mode: 0o755 })
  // The testing report (CEL-89) has its own tests (profile.test.ts); here `init` runs without it, so the
  // output is the project and the setup steps only.
  const agent = (cwd: string) => {
    const run = cello({ port, env: { ...claude, HOME: home, PATH: bin }, cwd })
    return (...args: string[]) => run(...args, ...(args[0] === "init" ? ["--skip-detect"] : []))
  }
  const projects = Effect.map(human["snapshot.get"]({}), (s) => s.projects)
  return { port, dataDir, home, human, agent, projects, url: (key: string) => `http://127.0.0.1:${port}/${key}` }
})

describe("cello init", () => {
  it.live("creates the project for a fresh repo: the folder's name, a key from it, the repo's path; context then works", () =>
    Effect.gen(function* () {
      const { dataDir, agent, projects, url } = yield* setup
      const repo = gitRepo(dataDir, "cello")
      expect(yield* agent(path.join(repo, "src"))("init")).toEqual({
        out: [`Created project CEL · cello for ${repo} (tasks CEL-1, CEL-2, …)`, url("CEL")].join("\n"),
        failure: null,
      })
      expect(yield* projects).toMatchObject([{ key: "CEL", name: "cello", repoPath: repo }])
      expect((yield* agent(repo)("context")).out).toContain(`Project   CEL · cello · ${repo}`)
    }).pipe(Effect.scoped))

  it.live("--name and --key choose them; --json prints the project", () =>
    Effect.gen(function* () {
      const { dataDir, agent } = yield* setup
      const repo = gitRepo(dataDir, "thai")
      const printed = yield* agent(repo)("init", "--name", "Thai Lookup", "--key", "thai", "--json")
      expect(printed.failure).toBeNull()
      expect(JSON.parse(printed.out)).toMatchObject({
        created: true,
        project: { key: "THAI", name: "Thai Lookup", repoPath: repo },
        hooks: null,
        agentsMd: null,
      })
    }).pipe(Effect.scoped))

  it.live("an already linked repo: says so and changes nothing", () =>
    Effect.gen(function* () {
      const { dataDir, agent, projects, url } = yield* setup
      const repo = gitRepo(dataDir, "cello")
      yield* agent(repo)("init")
      const before = yield* projects
      expect(yield* agent(repo)("init", "--key", "OTHER", "--name", "Other")).toEqual({
        out: [
          `This repo is already project CEL · cello (${repo}); the project itself is unchanged. --key and --name only apply to a new project.`,
          url("CEL"),
        ].join("\n"),
        failure: null,
      })
      expect((yield* agent(repo)("init", "--workspace", "Work")).out).toContain("the project itself is unchanged. --workspace only applies to a new project.")
      expect(yield* projects).toEqual(before)
    }).pipe(Effect.scoped))

  it.live("from a linked worktree, the project gets the main checkout's path and name", () =>
    Effect.gen(function* () {
      const { dataDir, agent, projects } = yield* setup
      const repo = gitRepo(dataDir, "cello")
      git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
      const worktree = path.join(dataDir, "agent-a686")
      git(repo, "worktree", "add", "-q", worktree)
      expect((yield* agent(worktree)("init")).failure).toBeNull()
      expect(yield* projects).toMatchObject([{ key: "CEL", name: "cello", repoPath: repo }])
      expect((yield* agent(repo)("init")).out).toContain("This repo is already project CEL")
    }).pipe(Effect.scoped))

  it.live("a taken --key is refused with the project that has it; without --key, a free one is picked", () =>
    Effect.gen(function* () {
      const { dataDir, human, agent, projects, url } = yield* setup
      const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
      yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Celery", key: "CEL" })
      const repo = gitRepo(dataDir, "cello")
      expect(yield* agent(repo)("init", "--key", "cel")).toEqual({
        out: "",
        failure: "The key CEL is taken by Celery. Pick another with --key, or leave --key out and Cello picks a free one.",
      })
      expect((yield* agent(repo)("init", "--key", "1X")).failure).toBe(
        "--key 1X won't do: a key must be 2 to 10 letters or digits, starting with a letter.",
      )
      expect((yield* agent(repo)("init", "--key", "builds")).failure).toBe(
        "--key builds won't do: a key can't be BUILDS, the address of Cello's Builds page (/builds).",
      )
      expect((yield* projects).map((p) => p.key)).toEqual(["CEL"])
      expect((yield* agent(repo)("init")).out).toBe([`Created project CELL · cello for ${repo} (tasks CELL-1, CELL-2, …)`, url("CELL")].join("\n"))
    }).pipe(Effect.scoped))

  it.live("a project made with another spelling of this repo is found, not duplicated: a trailing /, a symlink, a subfolder", () =>
    Effect.gen(function* () {
      const { dataDir, human, agent, projects } = yield* setup
      const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
      const alias = path.join(dataDir, "alias")
      fs.symlinkSync(dataDir, alias)
      const spellings = {
        trailing: (repo: string) => `${repo}/`,
        symlinked: (repo: string) => path.join(alias, path.basename(repo)),
        subfolder: (repo: string) => path.join(repo, "src"),
      }
      for (const [name, spell] of Object.entries(spellings)) {
        const repo = gitRepo(dataDir, name)
        yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name, repoPath: spell(repo) })
        expect((yield* agent(repo)("init")).out, name).toContain(`This repo is already project `)
      }
      expect((yield* projects).map((p) => p.name)).toEqual(Object.keys(spellings))
    }).pipe(Effect.scoped))

  it.live("a repo whose project was archived is refused, naming that project", () =>
    Effect.gen(function* () {
      const { dataDir, human, agent } = yield* setup
      const repo = gitRepo(dataDir, "cello")
      const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
      const { result } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Old Cello", key: "OLD", repoPath: repo })
      yield* human["project.archive"]({ commandId: newCommandId(), id: result.id })
      expect((yield* agent(repo)("init")).failure).toBe(
        `${repo} is already used by Old Cello (archived), so it can't be linked again. Ask the human what to do with it.`,
      )
    }).pipe(Effect.scoped))

  it.live("--workspace picks a workspace by name; an unknown one lists the real names", () =>
    Effect.gen(function* () {
      const { dataDir, human, agent } = yield* setup
      const { result: work } = yield* human["workspace.create"]({ commandId: newCommandId(), name: "Work" })
      const repo = gitRepo(dataDir, "cello")
      expect((yield* agent(repo)("init", "--workspace", "Nope")).failure).toBe('No workspace named "Nope". Workspaces: Personal, Work.')
      expect((yield* agent(repo)("init", "--workspace", "work")).failure).toBeNull()
      const created = yield* human["whoami"]({ project: { repoPath: repo } })
      expect(created.project).toMatchObject({ key: "CEL", workspaceId: work.id })
    }).pipe(Effect.scoped))

  it.live("outside a git repository it says so and creates nothing", () =>
    Effect.gen(function* () {
      const { dataDir, agent, projects } = yield* setup
      const folder = path.join(dataDir, "loose")
      fs.mkdirSync(folder)
      expect((yield* agent(folder)("init")).failure).toBe(
        "This folder isn't in a git repository. Run `cello init` inside the repo you want to track (`git init` first for a new one).",
      )
      expect(yield* projects).toEqual([])
    }).pipe(Effect.scoped))

  it.live("--hooks also installs the Claude Code hooks and plugin, in the main checkout's settings.local.json", () =>
    Effect.gen(function* () {
      const { dataDir, home, agent, url } = yield* setup
      const repo = gitRepo(dataDir, "cello")
      const file = path.join(repo, ".claude", "settings.local.json")
      const folder = path.join(home, ".local", "share", "cello", "claude-plugin")
      expect(yield* agent(repo)("init", "--hooks")).toEqual({
        out: [
          `Created project CEL · cello for ${repo} (tasks CEL-1, CEL-2, …)`,
          url("CEL"),
          `Installed Cello's Claude Code hooks in ${file} (this machine only):`,
          "  Stop                cello hook claude stop",
          "  PostToolUse         cello hook claude post-tool-use",
          "  PreToolUse          cello hook claude pre-tool-use",
          "  PostToolUseFailure  cello hook claude post-tool-use-failure",
          "  SubagentStart       cello hook claude subagent-start",
          "  SubagentStop        cello hook claude subagent-stop",
          `Enabled Cello's Claude Code plugin in ${file}; its files are in ${folder}.`,
          `Allowed \`cello\` commands in ${file} ("Bash(cello:*)" in permissions.allow), so Claude Code runs them without a permission check: ` +
          "agents reach the board only through `cello`, and a check that fails can't cut them off it.",
          `Added .claude/settings.local.json to ${path.join(repo, ".gitignore")}, so it stays on this machine.`,
          "Your comments and Send back notes on a task an agent session claimed now reach that session: when it stops, and after each tool call.",
          "The board names each subagent working under a session (a builder, a reviewer) and the task it was launched on: it hears them start, work and finish.",
          "Agents here can't publish Claude artifacts: they're told to publish a Cello page instead. Start Claude Code with CELLO_ALLOW_ARTIFACTS=1 when you want one.",
          "Orchestrating sessions, subagents and runs Cello woke can't ask you questions in Claude's own window, where nobody watches: they're told to ask on the card, where the task waits in Needs input. A session you chat with keeps the dialog. \"/cello:orchestrate off\" gives an orchestrating session it back; CELLO_ALLOW_ASK_USER=1 lets every session use it.",
          "Agents here can't edit files in the repo until their session has claimed a Cello task: they're told to create or claim one first. Start Claude Code with CELLO_ALLOW_UNTRACKED=1 to turn that off.",
          "The plugin gives new sessions /cello:orchestrate (run tasks the way the project's LIFECYCLE.md says, through builder and reviewer agents) and the cello skill.",
          "New Claude Code sessions pick them up.",
        ].join("\n"),
        failure: null,
      })
      const settings = JSON.parse(fs.readFileSync(file, "utf8"))
      expect(settings.hooks.Stop[0].hooks[0].command).toBe("cello hook claude stop")
      // The artifact guard (CEL-57) and the claim guard (CEL-61) come with it.
      expect(settings.hooks.PreToolUse).toEqual([{ matcher: "Artifact|AskUserQuestion|Edit|Write|NotebookEdit|Bash", hooks: [{ type: "command", command: "cello hook claude pre-tool-use", timeout: 10 }] }])
      // And the plugin (CEL-64).
      expect(settings.enabledPlugins).toEqual({ "cello@cello": true })
      // And the rule that lets `cello` skip Claude Code's permission check (CEL-90).
      expect(settings.permissions).toEqual({ allow: ["Bash(cello:*)"] })
      // Already linked and already installed: both say so.
      expect((yield* agent(repo)("init", "--hooks")).out).toBe([
        `This repo is already project CEL · cello (${repo}); the project itself is unchanged.`,
        url("CEL"),
        `Cello's Claude Code hooks are already in ${file}.`,
        `Cello's Claude Code plugin is already enabled in ${file}, and its files in ${folder} are current.`,
        `\`cello\` commands are already allowed in ${file}.`,
      ].join("\n"))
      expect(JSON.parse((yield* agent(repo)("init", "--hooks", "--json")).out).hooks).toEqual({ file, changed: false, pluginFolder: folder })
    }).pipe(Effect.scoped))

  it.live("when --hooks fails after the project was created, the output still says the project exists", () =>
    Effect.gen(function* () {
      const { dataDir, agent, url } = yield* setup
      const repo = gitRepo(dataDir, "cello")
      const file = path.join(repo, ".claude", "settings.local.json")
      fs.mkdirSync(path.dirname(file))
      fs.writeFileSync(file, "{ not json")
      expect(yield* agent(repo)("init", "--hooks")).toEqual({
        out: [`Created project CEL · cello for ${repo} (tasks CEL-1, CEL-2, …)`, url("CEL")].join("\n"),
        failure: `Project CEL is set up, but the next step failed: Can't update ${file}: it isn't valid JSON. Fix it first; Cello won't overwrite it.`,
      })
      expect(fs.readFileSync(file, "utf8")).toBe("{ not json")

      // With --json the project still comes back, with the failure as `error`.
      const json = yield* agent(repo)("init", "--hooks", "--agents-md", "--json")
      const message = `Project CEL is set up, but the next step failed: Can't update ${file}: it isn't valid JSON. Fix it first; Cello won't overwrite it.`
      expect(json.failure).toBe(message)
      expect(JSON.parse(json.out)).toMatchObject({
        created: false,
        project: { key: "CEL", repoPath: repo },
        url: url("CEL"),
        hooks: null,
        agentsMd: null,
        error: message,
      })
    }).pipe(Effect.scoped))

  it.live("--agents-md appends docs/cli.md's section to AGENTS.md between its markers, keeping what was there; again changes nothing", () =>
    Effect.gen(function* () {
      const { dataDir, agent } = yield* setup
      const repo = gitRepo(dataDir, "cello")
      const file = path.join(repo, "AGENTS.md")
      const original = "# Cello\n\nOur rules.\n"
      fs.writeFileSync(file, original)
      fs.writeFileSync(path.join(repo, "CLAUDE.md"), "Claude's own file.\n")
      const first = yield* agent(repo)("init", "--agents-md")
      expect(first.failure).toBeNull()
      expect(first.out).toContain(`Added the "Tracking work in Cello" section to ${file} (uncommitted).`)
      expect(fs.readFileSync(file, "utf8")).toBe(`${original}\n${marked("CEL")}\n`)
      expect(fs.readFileSync(path.join(repo, "CLAUDE.md"), "utf8")).toBe("Claude's own file.\n")

      const after = fs.readFileSync(file, "utf8")
      expect((yield* agent(repo)("init", "--agents-md")).out).toContain(`The "Tracking work in Cello" section in ${file} is already current.`)
      expect(fs.readFileSync(file, "utf8")).toBe(after)
    }).pipe(Effect.scoped))

  it.live("--agents-md brings an older marked section up to date, printing the lines that changed", () =>
    Effect.gen(function* () {
      const { dataDir, agent } = yield* setup
      const repo = gitRepo(dataDir, "cello")
      const file = path.join(repo, "AGENTS.md")
      const current = marked("CEL")
      // What an earlier version of Cello wrote: no copy needed.
      const older = agentsBlock(agentsSection(GUIDE, "CEL").replace("- Run `cello context` at the start of each session.", "- Claim a task before working on it."))
      fs.writeFileSync(file, `# Cello\n\n${older}\n\n## Ours\n`)
      const run = yield* agent(repo)("init", "--agents-md")
      expect(run.failure).toBeNull()
      expect(run.out.split("\n").slice(2)).toEqual([
        `Updated the "Tracking work in Cello" section in ${file} to the current text (uncommitted):`,
        "  - - Claim a task before working on it.",
        "  + - Run `cello context` at the start of each session.",
      ])
      expect(fs.readFileSync(file, "utf8")).toBe(`# Cello\n\n${current}\n\n## Ours\n`)
      expect(fs.existsSync(`${file}.bak`)).toBe(false)

      // Someone's note between the markers: rewritten too, with the old file kept and the note shown.
      const noted = `# Cello\n\n${current.replace(AGENTS_END, `- Our note: deploys go through Lucas.\n${AGENTS_END}`)}\n\n## Ours\n`
      fs.writeFileSync(file, noted)
      expect((yield* agent(repo)("init", "--agents-md")).out.split("\n").slice(2)).toEqual([
        `Updated the "Tracking work in Cello" section in ${file} to the current text (uncommitted). Its text wasn't exactly what Cello ` +
          `wrote, so the old file is kept as ${file}.bak; move any notes outside the markers. What changed:`,
        "  - - Our note: deploys go through Lucas.",
      ])
      expect(fs.readFileSync(`${file}.bak`, "utf8")).toBe(noted)
    }).pipe(Effect.scoped))

  it.live("--agents-md replaces an old section made only of earlier snippet lines, keeping a .bak; a section that isn't Cello's stays", () =>
    Effect.gen(function* () {
      const { dataDir, agent } = yield* setup
      const repo = gitRepo(dataDir, "cello")
      const file = path.join(repo, "AGENTS.md")
      // What `cello init --agents-md` wrote before the markers existed (8a8d6d6's snippet), untouched.
      const original = [
        "# Cello",
        "",
        "## Tracking work in Cello",
        "",
        "This repo's tasks live in Cello, project **CEL** on Lucas's board. Agents use it only through the `cello` CLI.",
        "",
        "- Run `cello context` at the start of each session.",
        "- Claim a task before working on it (`cello task claim CEL-n`), and put the key in commit messages (`fix(api): rate limit (CEL-12)`).",
        "",
        "## Ours",
        "",
        "Keep this.",
        "",
      ].join("\n")
      fs.writeFileSync(file, original)
      const run = yield* agent(repo)("init", "--agents-md")
      expect(run.failure).toBeNull()
      const lines = run.out.split("\n").slice(2)
      expect(lines[0]).toBe(
        `Replaced the old "Tracking work in Cello" section in ${file} with the current one, between cello:agents-md markers so later ` +
          `runs update it (uncommitted). Kept the old file as ${file}.bak. What changed:`,
      )
      expect(lines).toContain("  - - Claim a task before working on it (`cello task claim CEL-n`), and put the key in commit messages (`fix(api): rate limit (CEL-12)`).")
      expect(fs.readFileSync(file, "utf8")).toBe(`# Cello\n\n${marked("CEL")}\n\n## Ours\n\nKeep this.\n`)
      expect(fs.readFileSync(`${file}.bak`, "utf8")).toBe(original)
      expect((yield* agent(repo)("init", "--agents-md")).out).toContain("is already current.")

      const theirs = path.join(dataDir, "theirs")
      fs.mkdirSync(theirs)
      const other = gitRepo(theirs, "app")
      const own = "# App\n\n## Tracking work in Cello\n\nWe track work in a spreadsheet called Cello.\n"
      fs.writeFileSync(path.join(other, "AGENTS.md"), own)
      expect((yield* agent(other)("init", "--agents-md")).out).toContain(
        `${path.join(other, "AGENTS.md")} has a "Tracking work in Cello" section that isn't Cello's (it doesn't mention \`cello guide\` or ` +
          "`cello context`); left it as it is. Rename or remove it, then run this again to add Cello's.",
      )
      expect(fs.readFileSync(path.join(other, "AGENTS.md"), "utf8")).toBe(own)
    }).pipe(Effect.scoped))

  it.live("--agents-md leaves a customised section (like the Cello repo's own) as it is, showing the diff; --replace swaps it, keeping a .bak", () =>
    Effect.gen(function* () {
      const { dataDir, agent } = yield* setup
      const repo = gitRepo(dataDir, "cello")
      const file = path.join(repo, "AGENTS.md")
      // Snippet bullets plus the project's own rules, as the Cello repo's AGENTS.md has.
      const original = [
        "# Cello",
        "",
        "## Tracking work in Cello",
        "",
        "Cello's own backlog is the **CEL** project on Lucas's board (`cello start`, port 4747).",
        "",
        "- Run `cello context` at the start of each session.",
        "- **Feedback Lucas gives in chat is a review too.** Put it on the task as a comment, in his words.",
        "- Answer Lucas on the card with `cello task comment`. His comments come to your session by themselves.",
        "- hand finished work to Lucas **only with `cello task submit`**",
        "",
        "## Backups",
        "",
        "Keep this.",
        "",
      ].join("\n")
      fs.writeFileSync(file, original)
      const left = yield* agent(repo)("init", "--agents-md")
      expect(left.failure).toBeNull()
      const lines = left.out.split("\n").slice(2)
      expect(lines[0]).toBe(
        `${file} has its own 'Tracking work in Cello' section with lines Cello didn't write; leaving it. Run with \`--replace\` to swap ` +
          "it for Cello's (the old file is kept as .bak), or add the markers by hand. What swapping it would change:",
      )
      expect(lines).toContain("  - - **Feedback Lucas gives in chat is a review too.** Put it on the task as a comment, in his words.")
      expect(fs.readFileSync(file, "utf8")).toBe(original)
      expect(fs.existsSync(`${file}.bak`)).toBe(false)

      const json = JSON.parse((yield* agent(repo)("init", "--agents-md", "--json")).out)
      expect(json.agentsMd).toMatchObject({ file, changed: false, change: "customised", backup: null })
      expect(json.agentsMd.diff.length).toBeGreaterThan(0)

      const replaced = yield* agent(repo)("init", "--agents-md", "--replace")
      expect(replaced.out).toContain(`Replaced the old "Tracking work in Cello" section in ${file}`)
      expect(fs.readFileSync(file, "utf8")).toBe(`# Cello\n\n${marked("CEL")}\n\n## Backups\n\nKeep this.\n`)
      expect(fs.readFileSync(`${file}.bak`, "utf8")).toBe(original)
    }).pipe(Effect.scoped))

  it.live("--agents-md writes CLAUDE.md when there's no AGENTS.md, in the checkout it runs in (a worktree's own)", () =>
    Effect.gen(function* () {
      const { dataDir, agent } = yield* setup
      const repo = gitRepo(dataDir, "cello")
      git(repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init")
      const worktree = path.join(dataDir, "feature")
      git(repo, "worktree", "add", "-q", worktree)
      expect((yield* agent(worktree)("init", "--agents-md", "--key", "APP")).failure).toBeNull()
      expect(fs.readFileSync(path.join(worktree, "CLAUDE.md"), "utf8")).toBe(`${marked("APP")}\n`)
      expect(fs.existsSync(path.join(repo, "CLAUDE.md"))).toBe(false)
    }).pipe(Effect.scoped))
})
