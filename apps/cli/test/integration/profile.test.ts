// CEL-89: `cello init` inspects the repo and drafts the project's testing profile; `cello profile`
// reads and changes it; `cello context` shows it. Against a real server, temp repos, a temp HOME (with
// a fake Playwright browser cache) and a PATH holding fake ffmpeg and docker, so the machine checks
// don't depend on the computer running the test.
import * as fs from "node:fs"
import * as path from "node:path"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { cello, gitRepo } from "./cli.ts"

const claude = { CLAUDE_CODE_SESSION_ID: "2fd0505c-417a-4167-acfe-2d66080fcae0", CLAUDE_PID: String(process.pid) }

const write = (root: string, files: Record<string, string>) => {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true })
    fs.writeFileSync(path.join(root, name), text)
  }
}

/** A Vite app with Vitest and Playwright (videos on), on bun. */
const VITE_APP = {
  "package.json": JSON.stringify({
    name: "shop",
    scripts: { dev: "vite --port 5199", test: "vitest run", typecheck: "tsc --noEmit", "test:e2e": "playwright test" },
    devDependencies: { vite: "7.0.0", vitest: "3.0.0", "@playwright/test": "1.50.0", typescript: "5.6.0" },
  }),
  "bun.lock": "",
  "tsconfig.json": "{}",
  "playwright.config.ts": `export default { outputDir: "test-results/e2e", use: { video: "on", screenshot: "on" } }`,
}

const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const home = path.join(dataDir, "home")
  const bin = path.join(dataDir, "bin")
  fs.mkdirSync(bin)
  for (const tool of ["cello", "ffmpeg", "docker"]) fs.writeFileSync(path.join(bin, tool), "#!/bin/sh\n", { mode: 0o755 })
  const browsers = path.join(home, ".cache", "ms-playwright")
  fs.mkdirSync(path.join(browsers, "chromium-1200"), { recursive: true })
  const machine = { HOME: home, PATH: bin, PLAYWRIGHT_BROWSERS_PATH: browsers }
  const agent = (cwd: string) => cello({ port, env: { ...claude, ...machine }, cwd })
  const me = (cwd: string) => cello({ port, env: { CELLO_SESSION: "me", ...machine }, cwd })
  return { dataDir, port, agent, me }
})

describe("cello init's testing report (CEL-89)", () => {
  it.live("a repo with Vitest and Playwright: every evidence kind ready, and the profile drafted from what it found", () =>
    Effect.gen(function* () {
      const { dataDir, agent, port } = yield* setup
      const repo = gitRepo(dataDir, "shop")
      write(repo, VITE_APP)
      const printed = yield* agent(repo)("init")
      expect(printed.failure).toBeNull()
      expect(printed.out).toBe([
        `Created project SHO · shop for ${repo} (tasks SHO-1, SHO-2, …)`,
        `http://127.0.0.1:${port}/SHO`,
        "Testing: detected web (Vite) · bun · Vitest · Playwright",
        "  ready        unit tests           Vitest: bun run test",
        "  ready        e2e video            Playwright: bun run test:e2e",
        "  ready        screenshots          saved in test-results/e2e",
        "  ready        terminal transcript  commands to run and save with their output",
        "Wrote install, unit, typecheck, ui.runsIn, app.start, app.url, evidence.ui, evidence.cli, e2e.web.run, e2e.web.videos, " +
        "e2e.web.screenshots to the testing profile. See `cello profile`.",
      ].join("\n"))

      const profile = yield* agent(repo)("profile")
      expect(profile.out.split("\n")).toEqual([
        "Testing profile of SHO: current best knowledge of how to test this repo; fix a field when a command in it fails or the repo changes.",
        "  install              bun install  (detected, just now)",
        "  unit                 bun run test  (detected, just now)",
        "  typecheck            bun run typecheck  (detected, just now)",
        "  ui.runsIn            local  (detected, just now)",
        "  app.start            bun run dev  (detected, just now)",
        "  app.url              http://localhost:5199  (detected, just now)",
        "  evidence.ui          MP4 video of the e2e run of the flow, plus screenshots (light and dark when it matters)  (detected, just now)",
        "  evidence.cli         terminal transcript of the commands and their output, plus the test output  (detected, just now)",
        "  e2e.web.run          bun run test:e2e  (detected, just now)",
        "  e2e.web.videos       test-results/e2e  (detected, just now)",
        "  e2e.web.screenshots  test-results/e2e  (detected, just now)",
      ])
    }).pipe(Effect.scoped))

  it.live("an empty repo: every kind missing with what to do, nothing written; --skip-detect leaves the report out", () =>
    Effect.gen(function* () {
      const { dataDir, agent } = yield* setup
      const repo = gitRepo(dataDir, "blank")
      const printed = yield* agent(repo)("init")
      expect(printed.out.split("\n").slice(2)).toEqual([
        "Testing: nothing detected (no test runner, e2e tool or app found)",
        "  missing      unit tests           no unit test command found",
        "               → Add a unit test runner (Vitest: `npm add -D vitest`) and a \"test\" script.",
        "  missing      e2e video            no e2e tool found",
        "               → Set up Playwright (`npm init playwright@latest`) with use: { video: \"on\" }, so builders can record the flow headless.",
        "  missing      screenshots          no browser automation found",
        "               → Playwright (or Cypress) takes screenshots of each step; set it up with the e2e tool.",
        "  partial      terminal transcript  nothing to run yet",
        "               → Add a test script, so a transcript of it can show the change working.",
        "Nothing to write to the testing profile yet. Set fields as the repo gets them: `cello profile set <field> \"<value>\"`.",
      ])
      expect((yield* agent(repo)("profile")).out).toBe(
        "Testing profile of BLA: nothing set yet. `cello init` detects what it can; set a field with `cello profile set <field> \"<value>\"`.",
      )
      const skipped = yield* agent(repo)("init", "--skip-detect")
      expect(skipped.out).not.toContain("Testing")
      expect(skipped.out.split("\n")).toHaveLength(2)
    }).pipe(Effect.scoped))

  it.live("running init again keeps what an agent or the human set; --json carries the report and the profile", () =>
    Effect.gen(function* () {
      const { dataDir, agent, me } = yield* setup
      const repo = gitRepo(dataDir, "shop")
      write(repo, VITE_APP)
      yield* agent(repo)("init")
      expect((yield* agent(repo)("profile", "set", "app.url", "http://127.0.0.1:5199")).out).toBe("Set app.url to `http://127.0.0.1:5199`.")
      expect((yield* me(repo)("profile", "set", "unit", "bun run test:unit")).out).toBe("Set unit to `bun run test:unit`.")
      const again = JSON.parse((yield* agent(repo)("init", "--json")).out)
      expect(again).toMatchObject({ created: false, testing: { kept: ["unit", "app.url"], detection: { stack: ["web (Vite)"] } } })
      // Nothing new was found, so nothing was written.
      expect(again.testing.written).toEqual([])
      expect((yield* agent(repo)("init")).out.split("\n").at(-1)).toBe(
        "Wrote nothing new to the testing profile; kept unit and app.url, which an agent or the human set. See `cello profile`.",
      )
      const fields = Object.fromEntries((again.profile.fields as Array<{ field: string; value: string; source: string }>).map((f) => [f.field, `${f.value} (${f.source})`]))
      expect(fields).toMatchObject({ "unit": "bun run test:unit (human)", "app.url": "http://127.0.0.1:5199 (agent)", "install": "bun install (detected)" })
    }).pipe(Effect.scoped))

  it.live("running init again clears detected values it no longer finds, says which, and keeps what an agent set (CEL-96)", () =>
    Effect.gen(function* () {
      const { dataDir, agent } = yield* setup
      const repo = gitRepo(dataDir, "shop")
      write(repo, VITE_APP)
      yield* agent(repo)("init")
      yield* agent(repo)("profile", "set", "unit", "bun run test:unit")
      // The repo changes: the dev port comes from $PORT, and the e2e now runs in Docker.
      const pkg = JSON.parse(VITE_APP["package.json"])
      write(repo, { "package.json": JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, dev: "vite --port $PORT", "test:e2e": "bun scripts/test-in-docker.ts e2e" } }) })
      const again = yield* agent(repo)("init")
      expect(again.out.split("\n").slice(-2)).toEqual([
        "Wrote ui.runsIn to the testing profile; kept unit, which an agent or the human set. See `cello profile`.",
        "Cleared app.url, e2e.web.videos and e2e.web.screenshots: detected before, not found this time.",
      ])
      const json = JSON.parse((yield* agent(repo)("init", "--json")).out)
      expect(json.testing).toMatchObject({ written: [], cleared: [], kept: ["unit"] })
      const fields = Object.fromEntries((json.profile.fields as Array<{ field: string; value: string; source: string }>).map((f) => [f.field, `${f.value} (${f.source})`]))
      expect(fields).toMatchObject({ "unit": "bun run test:unit (agent)", "ui.runsIn": "docker (detected)", "e2e.web.run": "bun run test:e2e (detected)" })
      expect(fields["app.url"]).toBeUndefined()
      expect(fields["e2e.web.videos"]).toBeUndefined()
    }).pipe(Effect.scoped))

  it.live("init from a worktree with none of the repo's files finds nothing and keeps the profile as it is (CEL-96)", () =>
    Effect.gen(function* () {
      const { dataDir, agent } = yield* setup
      const repo = gitRepo(dataDir, "shop")
      const git = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", "-c", "user.email=t@t", "-c", "user.name=t", ...args], { cwd })
      // A first commit without the app's files, so a worktree of it has no package.json.
      git(repo, "commit", "-q", "--allow-empty", "-m", "init")
      write(repo, VITE_APP)
      yield* agent(repo)("init")
      const before = JSON.parse((yield* agent(repo)("profile", "--json")).out).fields
      expect(before.length).toBeGreaterThan(5)
      const worktree = path.join(dataDir, "bare-branch")
      git(repo, "worktree", "add", "-q", worktree)
      const empty = yield* agent(fs.realpathSync(worktree))("init")
      expect(empty.out.split("\n").at(-1)).toBe("Found nothing to detect here; kept the testing profile as it is.")
      expect(JSON.parse((yield* agent(repo)("profile", "--json")).out).fields).toEqual(before)
    }).pipe(Effect.scoped))
})

describe("cello profile (CEL-89)", () => {
  it.live("set and unset fields; an agent is refused a field the human set and told to ask on the card; the human overwrites", () =>
    Effect.gen(function* () {
      const { dataDir, agent, me } = yield* setup
      const repo = gitRepo(dataDir, "shop")
      yield* agent(repo)("init", "--skip-detect")
      expect((yield* agent(repo)("profile", "set", "e2e.web.run", "bun run test:e2e")).out).toBe("Set e2e.web.run to `bun run test:e2e`.")
      expect((yield* agent(repo)("profile", "set", "e2e.web.run", "bun run test:e2e")).out).toBe("Confirmed e2e.web.run: `bun run test:e2e`.")
      expect((yield* me(repo)("profile", "set", "install", "bun install")).out).toBe("Set install to `bun install`.")
      expect(yield* agent(repo)("profile", "set", "install", "npm ci")).toEqual({
        out: "",
        failure: "Lucas set install (`bun install`), so an agent can't change it. If it's wrong, ask them on the card " +
          "on your task: `cello task ask <KEY-n> --title \"Change install in the testing profile?\" --question \"…\" --option \"A\" --option \"B\"` " +
          "(or --file ask.json; see `cello guide`, \"Questions for the human\"), and say so in your packet.",
      })
      expect((yield* agent(repo)("profile", "unset", "install")).failure).toContain("Lucas set install (`bun install`)")
      expect((yield* agent(repo)("profile", "set", "deploy", "x")).failure).toMatch(/^Unknown field "deploy"\. Fields: install, unit/)
      expect((yield* agent(repo)("profile", "set", "ui.runsIn", "vm")).failure).toBe('The value of ui.runsIn must be "local" or "docker", not "vm".')
      expect((yield* me(repo)("profile", "unset", "e2e.web.run")).out).toBe("Unset e2e.web.run.")
      expect((yield* me(repo)("profile", "unset", "e2e.web.run")).out).toBe("e2e.web.run wasn't set.")
      const shown = JSON.parse((yield* agent(repo)("profile", "--json")).out)
      expect(shown.fields).toMatchObject([{ field: "install", value: "bun install", source: "human" }])
    }).pipe(Effect.scoped))

  it.live("cello context shows the profile and what's missing; profile changes show in its recent activity", () =>
    Effect.gen(function* () {
      const { dataDir, agent } = yield* setup
      const repo = gitRepo(dataDir, "shop")
      write(repo, VITE_APP)
      yield* agent(repo)("init")
      yield* agent(repo)("profile", "unset", "typecheck")
      const out = (yield* agent(repo)("context")).out
      expect(out).toContain([
        "Testing   how to test this repo and collect evidence; current best knowledge, so fix it with `cello profile set` when it's wrong",
        "  install              bun install  (detected)",
      ].join("\n"))
      expect(out).toContain("  missing: typecheck\n")
      expect(out).toMatch(/just now\s+Claude Code session 2fd0505c unset the testing profile's typecheck/)
    }).pipe(Effect.scoped))
})
