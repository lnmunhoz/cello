// How a repo tests, worked out from its files (CEL-89): the stack, package manager, unit runner,
// typecheck, e2e tool and its folders, how to start the app, and a readiness report per kind of
// evidence a review packet needs. Plain code over file names and contents, no AI; reading the repo and
// checking the machine (ffmpeg, Docker, Playwright's browsers) happens in the CLI, which passes the
// facts in. The result is a first draft of the project's testing profile, not the truth: agents and
// Lucas correct it later.

export interface PackageJson {
  readonly scripts?: Readonly<Record<string, string>>
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
  readonly bin?: unknown
  readonly main?: unknown
  readonly exports?: unknown
  readonly workspaces?: unknown
}

export interface RepoFacts {
  /** Paths that exist, relative to the repo root with "/", files and folders alike ("apps/web/vite.config.ts", ".maestro"). */
  readonly paths: ReadonlyArray<string>
  /** Every package.json read: the root's first, then workspace members'. */
  readonly packages: ReadonlyArray<{ readonly path: string; readonly json: PackageJson }>
  /** The text of the config files in CONFIG_FILES that exist, by path. */
  readonly texts: Readonly<Record<string, string>>
}

export interface MachineFacts {
  readonly ffmpeg: boolean
  readonly docker: boolean
  /** Playwright's browsers are downloaded (its cache folder has some). */
  readonly playwrightBrowsers: boolean
}

export const EVIDENCE_KINDS = ["unit tests", "e2e video", "screenshots", "terminal transcript"] as const
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]
export type Readiness = "ready" | "partial" | "missing" | "not needed"

export interface ReadinessLine {
  readonly kind: EvidenceKind
  readonly state: Readiness
  /** What was found, in a few words. */
  readonly note: string
  /** One line on what to do; null when there's nothing to do. */
  readonly suggestion: string | null
}

export interface Detection {
  /** "web (Vite)", "desktop (Electron)", "mobile (Expo)", "CLI", "backend (Go)", "library". */
  readonly stack: ReadonlyArray<string>
  readonly packageManager: string | null
  readonly tools: { readonly unit: string | null; readonly e2e: ReadonlyArray<string> }
  /** Testing-profile values found, by field name. */
  readonly fields: Readonly<Record<string, string>>
  readonly readiness: ReadonlyArray<ReadinessLine>
}

/** Files at the root (and in each workspace package) whose existence the reader reports. */
export const MARKER_FILES = [
  "package.json", "bun.lock", "bun.lockb", "pnpm-lock.yaml", "yarn.lock", "package-lock.json", "tsconfig.json",
  "pyproject.toml", "requirements.txt", "uv.lock", "poetry.lock", "go.mod", "Cargo.toml", "tests", ".maestro",
  "Dockerfile", "docker-compose.yml",
]

/** Config files whose text detection reads. */
export const CONFIG_FILES = [
  "playwright.config.ts", "playwright.config.js", "playwright.config.mjs",
  "cypress.config.ts", "cypress.config.js",
  "vite.config.ts", "vite.config.js", "vite.config.mjs",
  "pyproject.toml",
]

const UI_EVIDENCE = "MP4 video of the e2e run of the flow, plus screenshots (light and dark when it matters)"
const CLI_EVIDENCE = "terminal transcript of the commands and their output, plus the test output"

const has = (facts: RepoFacts, name: string) => facts.paths.includes(name)
const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1)

interface Runner {
  readonly name: string | null
  readonly install: string | null
  /** A package.json script. */
  readonly script: (name: string) => string
  /** A binary from the project's dependencies. */
  readonly exec: (command: string) => string
}

const JS_RUNNERS: Record<string, Omit<Runner, "name">> = {
  bun: { install: "bun install", script: (s) => `bun run ${s}`, exec: (c) => `bunx ${c}` },
  pnpm: { install: "pnpm install", script: (s) => `pnpm ${s}`, exec: (c) => `pnpm exec ${c}` },
  yarn: { install: "yarn install", script: (s) => `yarn ${s}`, exec: (c) => `yarn ${c}` },
  npm: { install: "npm install", script: (s) => `npm run ${s}`, exec: (c) => `npx ${c}` },
}

const jsManager = (facts: RepoFacts): string | null => {
  if (has(facts, "bun.lock") || has(facts, "bun.lockb")) return "bun"
  if (has(facts, "pnpm-lock.yaml")) return "pnpm"
  if (has(facts, "yarn.lock")) return "yarn"
  return has(facts, "package.json") || facts.packages.length > 0 ? "npm" : null
}

const pythonRunner = (facts: RepoFacts): { name: string; install: string; prefix: string } | null => {
  if (!has(facts, "pyproject.toml") && !has(facts, "requirements.txt")) return null
  if (has(facts, "uv.lock")) return { name: "uv", install: "uv sync", prefix: "uv run " }
  if (has(facts, "poetry.lock")) return { name: "poetry", install: "poetry install", prefix: "poetry run " }
  return { name: "pip", install: has(facts, "requirements.txt") ? "pip install -r requirements.txt" : "pip install -e .", prefix: "" }
}

const E2E_WORDS = /playwright|cypress|detox|maestro|e2e/i

/** The first script of `names` the root package.json has. */
const firstScript = (scripts: Readonly<Record<string, string>>, names: ReadonlyArray<string>) => names.find((n) => scripts[n] !== undefined)

const unitRunnerName = (command: string, deps: ReadonlySet<string>): string | null => {
  if (/\bvitest\b/.test(command)) return "Vitest"
  if (/\bjest\b/.test(command)) return "Jest"
  if (/\bbun test\b/.test(command)) return "bun test"
  if (/\bmocha\b/.test(command)) return "Mocha"
  if (/\bpytest\b/.test(command)) return "pytest"
  if (/\bgo test\b/.test(command)) return "go test"
  if (/\bcargo test\b/.test(command)) return "cargo test"
  return deps.has("vitest") ? "Vitest" : deps.has("jest") ? "Jest" : null
}

/** The port a dev script names (`--port 5199`, `-p 3000`), else the config's, else the framework's default. */
const portOf = (script: string, facts: RepoFacts, stack: ReadonlyArray<string>): string | null => {
  const flag = /(?:--port[= ]|-p )(\d{2,5})/.exec(script)
  if (flag) return flag[1]!
  const config = Object.entries(facts.texts).find(([p]) => basename(p).startsWith("vite.config."))
  const fromConfig = config && /\bport:\s*(\d{2,5})/.exec(config[1])
  if (fromConfig) return fromConfig[1]!
  if (stack.includes("web (Next)")) return "3000"
  if (stack.includes("web (Vite)")) return "5173"
  if (stack.some((s) => s.startsWith("mobile"))) return "8081"
  return null
}

interface E2E {
  readonly tool: string
  readonly surface: string
  readonly run: string
  readonly videos: string | null
  readonly screenshots: string | null
  /** Why videos aren't ready yet, beyond the machine. */
  readonly videoProblem: string | null
}

export const detectRepo = (facts: RepoFacts, machine: MachineFacts): Detection => {
  const root = facts.packages.find((p) => p.path === "package.json")?.json ?? {}
  const scripts = root.scripts ?? {}
  const deps = new Set(facts.packages.flatMap((p) => [...Object.keys(p.json.dependencies ?? {}), ...Object.keys(p.json.devDependencies ?? {})]))
  const manager = jsManager(facts)
  const js: Runner | null = manager ? { name: manager, ...JS_RUNNERS[manager]! } : null
  const python = pythonRunner(facts)
  const go = has(facts, "go.mod")
  const rust = has(facts, "Cargo.toml")
  const text = (name: string) => Object.entries(facts.texts).find(([p]) => basename(p) === name)?.[1] ?? ""

  // ── stack ──
  const stack: string[] = []
  if (deps.has("next")) stack.push("web (Next)")
  else if (deps.has("vite")) stack.push("web (Vite)")
  if (deps.has("electron")) stack.push("desktop (Electron)")
  if (deps.has("expo")) stack.push("mobile (Expo)")
  else if (deps.has("react-native")) stack.push("mobile (React Native)")
  if (facts.packages.some((p) => p.json.bin !== undefined)) stack.push("CLI")
  if (["express", "fastify", "hono", "koa", "@nestjs/core"].some((d) => deps.has(d))) stack.push("backend (Node)")
  if (go) stack.push("backend (Go)")
  if (python) stack.push("backend (Python)")
  if (rust) stack.push("Rust")
  if (stack.length === 0 && (root.main !== undefined || root.exports !== undefined)) stack.push("library")
  const ui = stack.some((s) => /^(web|desktop|mobile)/.test(s))

  const fields: Record<string, string> = {}

  // ── install, unit, typecheck ──
  const install = js?.install ?? python?.install ?? (go ? "go mod download" : rust ? "cargo fetch" : null)
  if (install) fields["install"] = install

  const unitScript = scripts["test"] !== undefined && !E2E_WORDS.test(scripts["test"]) ? "test" : firstScript(scripts, ["test:unit", "unit"])
  let unitCommand: string | null = null
  let unitText = ""
  if (js && unitScript) {
    unitCommand = manager === "pnpm" && unitScript === "test" ? "pnpm test" : js.script(unitScript)
    unitText = scripts[unitScript]!
  } else if (go) {
    unitCommand = unitText = "go test ./..."
  } else if (rust) {
    unitCommand = unitText = "cargo test"
  } else if (python && (/pytest/.test(text("pyproject.toml")) || has(facts, "tests"))) {
    unitCommand = `${python.prefix}pytest`
    unitText = "pytest"
  } else if (js && deps.has("vitest")) {
    unitCommand = unitText = js.exec("vitest run")
  } else if (js && deps.has("jest")) {
    unitCommand = unitText = js.exec("jest")
  }
  if (unitCommand) fields["unit"] = unitCommand
  const unitRunner = unitCommand ? unitRunnerName(unitText, deps) : null

  const typecheckScript = firstScript(scripts, ["typecheck", "type-check", "check-types", "tsc", "types"])
  if (js && typecheckScript) fields["typecheck"] = js.script(typecheckScript)
  else if (js && has(facts, "tsconfig.json") && deps.has("typescript")) fields["typecheck"] = js.exec("tsc --noEmit")
  else if (go) fields["typecheck"] = "go vet ./..."
  else if (python && /mypy/.test(text("pyproject.toml"))) fields["typecheck"] = `${python.prefix}mypy .`

  // ── e2e ──
  const e2e: E2E[] = []
  const scriptRunning = (pattern: RegExp, names: ReadonlyArray<string>) => {
    const named = firstScript(scripts, names)
    const name = named ?? Object.keys(scripts).find((n) => pattern.test(scripts[n]!))
    return js && name ? js.script(name) : null
  }
  const playwrightConfig = Object.entries(facts.texts).find(([p]) => basename(p).startsWith("playwright.config."))
  if (deps.has("@playwright/test") || deps.has("playwright") || playwrightConfig) {
    const config = playwrightConfig?.[1] ?? ""
    const out = /\boutputDir:\s*["'`]([^"'`]+)["'`]/.exec(config)?.[1] ?? "test-results"
    const video = /\bvideo:[^,}\n]*["'](on|retain-on-failure|on-first-retry)["']/.test(config)
    e2e.push({
      tool: "Playwright",
      surface: stack.some((s) => s.startsWith("web")) || !deps.has("electron") ? "web" : "desktop",
      run: scriptRunning(/playwright test/, ["test:e2e", "e2e", "test:e2e:local", "playwright"]) ?? (js ?? JS_RUNNERS.npm!).exec("playwright test"),
      videos: out,
      screenshots: out,
      videoProblem: video ? null : `turn videos on in ${playwrightConfig ? basename(playwrightConfig[0]) : "playwright.config.ts"} (use: { video: "on" })`,
    })
  }
  if (deps.has("cypress")) {
    const config = Object.entries(facts.texts).find(([p]) => basename(p).startsWith("cypress.config."))?.[1] ?? ""
    e2e.push({
      tool: "Cypress",
      surface: "web",
      run: scriptRunning(/cypress run/, ["test:e2e", "e2e", "cypress:run"]) ?? (js ?? JS_RUNNERS.npm!).exec("cypress run"),
      videos: "cypress/videos",
      screenshots: "cypress/screenshots",
      videoProblem: /\bvideo:\s*true/.test(config) ? null : "turn videos on in cypress.config (video: true)",
    })
  }
  if (has(facts, ".maestro")) {
    e2e.push({ tool: "Maestro", surface: "mobile", run: "maestro test .maestro", videos: null, screenshots: null, videoProblem: "record flows with `maestro record`" })
  }
  if (deps.has("detox")) {
    e2e.push({
      tool: "Detox",
      surface: "mobile",
      run: scriptRunning(/detox test/, ["test:e2e", "e2e"]) ?? (js ?? JS_RUNNERS.npm!).exec("detox test"),
      videos: "artifacts",
      screenshots: "artifacts",
      videoProblem: "run with --record-videos all",
    })
  }
  const surfaces = new Set<string>()
  for (const entry of e2e) {
    if (surfaces.has(entry.surface)) continue
    surfaces.add(entry.surface)
    fields[`e2e.${entry.surface}.run`] = entry.run
    if (entry.videos) fields[`e2e.${entry.surface}.videos`] = entry.videos
    if (entry.screenshots) fields[`e2e.${entry.surface}.screenshots`] = entry.screenshots
  }
  if (ui && e2e.length > 0) {
    const runs = e2e.map((entry) => entry.run.replace(/^(bun run|npm run|pnpm|yarn) /, "")).map((s) => scripts[s] ?? s)
    fields["ui.runsIn"] = runs.some((r) => /docker/i.test(r)) ? "docker" : "local"
  }

  // ── the app ──
  const startScript = firstScript(scripts, ["dev", "start"])
  if (js && startScript) fields["app.start"] = manager === "npm" && startScript === "start" ? "npm start" : js.script(startScript)
  const baseUrl = playwrightConfig && /\bbaseURL:\s*["'`](https?:\/\/[^"'`]+)["'`]/.exec(playwrightConfig[1])?.[1]
  const port = startScript ? portOf(scripts[startScript]!, facts, stack) : null
  if (baseUrl) fields["app.url"] = baseUrl
  else if (port) fields["app.url"] = `http://localhost:${port}`

  if (ui) fields["evidence.ui"] = UI_EVIDENCE
  if (stack.length > 0) fields["evidence.cli"] = CLI_EVIDENCE

  // ── readiness ──
  const playwright = e2e.some((entry) => entry.tool === "Playwright")
  const readiness: ReadinessLine[] = []
  const add = (kind: EvidenceKind, state: Readiness, note: string, suggestion: string | null) => readiness.push({ kind, state, note, suggestion })
  const knownNoUi = stack.length > 0 && !ui

  if (unitCommand) add("unit tests", "ready", `${unitRunner ?? "tests"}: ${unitCommand}`, null)
  else {
    add("unit tests", "missing", "no unit test command found", python
      ? "Add pytest and a tests/ folder, then set it with `cello profile set unit \"pytest\"`."
      : go
      ? "Add *_test.go files; `go test ./...` runs them."
      : `Add a unit test runner (Vitest: \`${manager ?? "npm"} add -D vitest\`) and a "test" script.`)
  }

  if (knownNoUi) {
    add("e2e video", "not needed", "no UI detected", null)
    add("screenshots", "not needed", "no UI detected", null)
  } else if (e2e.length === 0) {
    const mobile = stack.some((s) => s.startsWith("mobile"))
    add("e2e video", "missing", "no e2e tool found", mobile
      ? "Set up Maestro flows in .maestro/ and record them, so builders can show the flow on a simulator."
      : `Set up Playwright (\`npm init playwright@latest\`) with use: { video: "on" }, so builders can record the flow headless.`)
    add("screenshots", "missing", "no browser automation found", "Playwright (or Cypress) takes screenshots of each step; set it up with the e2e tool.")
  } else {
    const first = e2e[0]!
    const problems = [
      ...(first.videoProblem ? [first.videoProblem] : []),
      ...(playwright && !machine.playwrightBrowsers ? ["download a browser with `npx playwright install chromium`"] : []),
      ...(!machine.ffmpeg ? ["install ffmpeg to turn the videos into MP4"] : []),
      ...(fields["ui.runsIn"] === "docker" && !machine.docker ? ["install or start Docker: the e2e runs in it"] : []),
    ]
    add("e2e video", problems.length ? "partial" : "ready", `${e2e.map((entry) => entry.tool).join(", ")}: ${first.run}`,
      problems.length ? `${problems.join("; ")}.` : null)
    const shotsProblem = playwright && !machine.playwrightBrowsers
    add("screenshots", shotsProblem ? "partial" : "ready", first.screenshots ? `saved in ${first.screenshots}` : `${first.tool} can take them`,
      shotsProblem ? "Download a browser with `npx playwright install chromium`." : null)
  }

  const anything = unitCommand ?? fields["app.start"] ?? fields["typecheck"]
  add("terminal transcript", anything ? "ready" : "partial", anything ? "commands to run and save with their output" : "nothing to run yet",
    anything ? null : "Add a test script, so a transcript of it can show the change working.")

  return {
    stack,
    packageManager: js?.name ?? python?.name ?? (go ? "go" : rust ? "cargo" : null),
    tools: { unit: unitRunner, e2e: e2e.map((entry) => entry.tool) },
    fields,
    readiness,
  }
}
