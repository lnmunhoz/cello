// How a repo tests, worked out from its files (CEL-89): the stack, package manager, unit runner,
// typecheck, e2e tool and its folders, how to start the app, and a readiness report per kind of
// evidence a review packet needs. Plain code over file names and contents, no AI; reading the repo and
// checking the machine (ffmpeg, Docker, Playwright's browsers) happens in the CLI, which passes the
// facts in. The result is a first draft of the project's testing profile, not the truth: agents and
// Lucas correct it later. A value it can't settle from the files (a variable with no default, a run that
// goes through a wrapper) is left out rather than written wrong (CEL-96).

export interface PackageJson {
  readonly name?: string
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
  /**
   * Fields detection found a hint for but couldn't settle (a baseURL naming a variable with no default), with
   * why: left out of `fields`, never written half-resolved (CEL-96).
   */
  readonly unresolved: ReadonlyArray<{ readonly field: string; readonly why: string }>
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

// ── values in config files ──

/** The expression after `key:` in a config's text, up to the comma, closing bracket or line end that ends it. */
const exprAfter = (text: string, key: string): string | null => {
  const found = new RegExp(`\\b${key}\\s*:\\s*`).exec(text)
  if (!found) return null
  const start = found.index + found[0].length
  let depth = 0
  let quote: string | null = null
  let i = start
  for (; i < text.length; i++) {
    const c = text[i]!
    if (quote) {
      if (c === "\\") i++
      else if (c === quote) quote = null
    } else if (c === "\"" || c === "'" || c === "`") quote = c
    else if ("([{".includes(c)) depth++
    else if (")]}".includes(c)) {
      if (depth === 0) break
      depth--
    } else if ((c === "," || c === "\n") && depth === 0) break
  }
  return text.slice(start, i).trim() || null
}

/** `expr` split at its top-level `??` and `||`, outside quotes and brackets. */
const alternatives = (expr: string): string[] => {
  const parts: string[] = []
  let depth = 0
  let quote: string | null = null
  let from = 0
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]!
    if (quote) {
      if (c === "\\") i++
      else if (c === quote) quote = null
    } else if (c === "\"" || c === "'" || c === "`") quote = c
    else if ("([{".includes(c)) depth++
    else if (")]}".includes(c)) depth--
    else if (depth === 0 && (expr.startsWith("??", i) || expr.startsWith("||", i))) {
      parts.push(expr.slice(from, i))
      from = i + 2
      i++
    }
  }
  return [...parts, expr.slice(from)].map((part) => part.trim())
}

const ENV_READ = /^process\.env(?:\.\w+|\[["']\w+["']\])$/

/**
 * What a config expression comes to when nothing is set in the environment, when the file alone says so:
 * a string or number literal; `process.env.X ?? <default>` (or `||`), its default; Number(…), String(…) or
 * parseInt(…) around one; a const in the file that holds one; a template literal whose every `${…}` resolves.
 * Anything else, `process.env.X` with no default included, is null: detection never writes a value with a
 * variable left in it (CEL-96).
 */
const evaluate = (expr: string, text: string, depth = 0): string | null => {
  const e = expr.trim()
  if (depth > 5 || e === "") return null
  const call = /^(?:Number|String|parseInt|parseFloat)\(([\s\S]*?)(?:,\s*\d+)?\)$/.exec(e)
  if (call) return evaluate(call[1]!, text, depth + 1)
  const options = alternatives(e)
  if (options.length > 1) {
    const set = options.find((option) => !ENV_READ.test(option))
    return set === undefined ? null : evaluate(set, text, depth + 1)
  }
  if (/^\([\s\S]*\)$/.test(e)) return evaluate(e.slice(1, -1), text, depth + 1)
  const quoted = /^(["'])((?:(?!\1)[^\\]|\\.)*)\1$/.exec(e)
  if (quoted) return quoted[2]!
  if (/^\d+(?:\.\d+)?$/.test(e)) return e
  const template = /^`([^`]*)`$/.exec(e)
  if (template) {
    let open = false
    const value = template[1]!.replace(/\$\{([^}]*)\}/g, (_, inner: string) => {
      const resolved = evaluate(inner, text, depth + 1)
      if (resolved === null) open = true
      return resolved ?? ""
    })
    return open ? null : value
  }
  if (/^[A-Za-z_$][\w$]*$/.test(e)) {
    const defined = new RegExp(`\\b(?:const|let|var)\\s+${e.replace(/\$/g, "\\$")}\\s*=\\s*([^\\n;]+)`).exec(text)
    // A comment after the value goes; "//" inside a quoted URL stays.
    return defined ? evaluate(defined[1]!.replace(/\s+\/\/[^"'`]*$/, ""), text, depth + 1) : null
  }
  return null
}

const NO_DEFAULT = "which names a variable with no default there"

/** An expression as markdown code: a template literal already is (`http://localhost:${PORT}`). */
const code = (expr: string) => (expr.startsWith("`") ? expr : `\`${expr}\``)

/**
 * The app's port: the one a dev script names (`--port 5199`, `-p 3000`), else vite.config's, else the
 * framework's default. A port behind a variable with no default is why it can't tell.
 */
const portOf = (script: string, facts: RepoFacts, stack: ReadonlyArray<string>): { port: string } | { why: string } | null => {
  const flag = /(?:--port[= ]|-p )(\d{2,5}\b|\$\{?\w+\}?)/.exec(script)
  if (flag) return /^\d+$/.test(flag[1]!) ? { port: flag[1]! } : { why: `the dev script passes \`${flag[0]}\`, which names a variable` }
  const config = Object.entries(facts.texts).find(([p]) => basename(p).startsWith("vite.config."))
  const expr = config && exprAfter(config[1], "port")
  if (config && expr) {
    const port = evaluate(expr, config[1])
    return port !== null && /^\d{2,5}$/.test(port) ? { port } : { why: `the port in ${config[0]} is ${code(expr)}, ${NO_DEFAULT}` }
  }
  if (stack.includes("web (Next)")) return { port: "3000" }
  if (stack.includes("web (Vite)")) return { port: "5173" }
  if (stack.some((s) => s.startsWith("mobile"))) return { port: "8081" }
  return null
}

/** How an e2e surface runs: the command to type, and the script it runs in the end (null when it isn't a script). */
interface Run {
  readonly command: string
  readonly body: string | null
}

interface E2E {
  readonly tool: string
  readonly surface: string
  readonly run: Run
  readonly videos: string | null
  readonly screenshots: string | null
  /** Why videos aren't ready yet, beyond the machine. */
  readonly videoProblem: string | null
  /** Why screenshots aren't ready yet, beyond the machine. */
  readonly shotsProblem: string | null
}

/** Script names that usually run a package's e2e tests. */
const E2E_SCRIPTS = ["test:e2e", "e2e", "test:e2e:local", "playwright"]
const TESTISH = /e2e|playwright|docker|test/i
const SURFACE_WORDS: Record<string, RegExp> = { web: /\bweb\b/i, desktop: /\b(desktop|electron)\b/i }

const dirOf = (file: string) => (file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "")
const under = (dir: string, folder: string) => (dir && !folder.startsWith("/") ? `${dir}/${folder.replace(/^\.\//, "")}` : folder.replace(/^\.\//, ""))
const unique = <A>(items: ReadonlyArray<A>) => [...new Set(items)]

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
  // The repo's JS runner; npm when there's no package.json, for the `npx playwright test` fallback.
  const runner = js ?? { name: "npm", ...JS_RUNNERS.npm! }
  const packageAt = (dir: string) => facts.packages.find((p) => p.path === (dir ? `${dir}/package.json` : "package.json"))
  /** A script's command, following a script that only calls another one (`bun run e2e:ci`). */
  const scriptBody = (own: Readonly<Record<string, string>>, name: string, depth = 0): string => {
    const next = /^(?:bun|npm|pnpm|yarn)(?:\s+run)?\s+([\w:.-]+)$/.exec(own[name]!.trim())?.[1]
    return next && next !== name && own[next] !== undefined && depth < 3 ? scriptBody(own, next, depth + 1) : own[name]!
  }
  /** A script of the package in `dir` ("" for the root), run from the root. */
  const script = (name: string, dir = ""): Run => {
    const own = packageAt(dir)?.json.scripts ?? {}
    return { command: `${dir ? `cd ${dir} && ` : ""}${runner.script(name)}`, body: scriptBody(own, name) }
  }
  const scriptRunning = (pattern: RegExp, names: ReadonlyArray<string>): Run | null => {
    const name = firstScript(scripts, names) ?? Object.keys(scripts).find((n) => pattern.test(scripts[n]!))
    return js && name ? script(name) : null
  }
  /**
   * One entry. A run that goes through Docker or a wrapper script (anything but the tool itself) leaves its
   * videos and screenshots where the wrapper puts them, not in the tool's folder, so those stay unset and the
   * report says to set them (CEL-96).
   */
  const entry = (tool: string, direct: RegExp, found: Omit<E2E, "tool" | "shotsProblem"> & { readonly shotsProblem?: string | null }): E2E => {
    const body = found.run.body
    const wrapped = body !== null && (/docker/i.test(body) || !direct.test(body))
    if (!wrapped) return { tool, shotsProblem: null, ...found }
    const through = `the run goes through \`${body}\`, not straight to ${tool}`
    return {
      ...found,
      tool,
      videos: null,
      screenshots: null,
      videoProblem: `set e2e.${found.surface}.videos to the folder its finished videos land in: ${through}`,
      shotsProblem: `set e2e.${found.surface}.screenshots to the folder its screenshots land in: ${through}`,
    }
  }
  const e2e: E2E[] = []
  // One entry per Playwright config (the root's and each workspace package's), each with its surface.
  const playwrightConfigs = Object.entries(facts.texts).filter(([p]) => basename(p).startsWith("playwright.config."))
  if (deps.has("@playwright/test") || deps.has("playwright") || playwrightConfigs.length > 0) {
    const configs: ReadonlyArray<readonly [string, string]> = playwrightConfigs.length > 0 ? playwrightConfigs : [["playwright.config.ts", ""]]
    /** What names a workspace package's config in a script: its folder (and so its path) and its package name. */
    const idsOf = (file: string) => {
      const dir = dirOf(file)
      return dir ? [dir, ...(packageAt(dir)?.json.name ? [packageAt(dir)!.json.name!] : [])] : []
    }
    for (const [file, config] of configs) {
      const dir = dirOf(file)
      const own = packageAt(dir)?.json
      const electron = own?.dependencies?.["electron"] !== undefined || own?.devDependencies?.["electron"] !== undefined
      const surface = electron || /\b_electron\b/.test(config) ? "desktop" : "web"
      const ids = idsOf(file)
      const others = configs.flatMap(([f]) => (f === file ? [] : idsOf(f)))
      const rootScript = (test: (name: string, body: string) => boolean) => Object.keys(scripts).find((n) => test(n, scripts[n]!))
      // The run, first found wins: a root script naming this package's folder or name; a root test script
      // naming the surface (test:docker:desktop); for the root's config, the usual e2e script names, then a
      // script running `playwright test` that names no other config; for a package's, its own e2e script, run
      // from its folder; else Playwright on this config.
      const ownScripts = own?.scripts ?? {}
      const fromRoot = !js ? undefined
        : (ids.length > 0 ? rootScript((n, b) => ids.some((id) => b.includes(id)) && (TESTISH.test(n) || /playwright/.test(b))) : undefined)
          ?? rootScript((n) => SURFACE_WORDS[surface]!.test(n) && TESTISH.test(n))
          ?? (dir ? undefined : firstScript(scripts, E2E_SCRIPTS) ?? rootScript((_, b) => /playwright test/.test(b) && !others.some((id) => b.includes(id))))
      const fromPackage = js && dir ? firstScript(ownScripts, E2E_SCRIPTS) ?? Object.keys(ownScripts).find((n) => /playwright test/.test(ownScripts[n]!)) : undefined
      const run: Run = fromRoot ? script(fromRoot)
        : fromPackage ? script(fromPackage, dir)
        : { command: runner.exec(dir ? `playwright test -c ${file}` : "playwright test"), body: null }
      const outExpr = exprAfter(config, "outputDir")
      const out = outExpr === null ? "test-results" : evaluate(outExpr, config)
      const name = playwrightConfigs.length > 0 ? file : "playwright.config.ts"
      const video = /\bvideo:[^,}\n]*["'](on|retain-on-failure|on-first-retry)["']/.test(config)
      const folder = out === null ? null : under(dir, out)
      e2e.push(entry("Playwright", /\bplaywright\s+test\b/, surface === "desktop"
        ? {
          // Electron records where the tests launch it (_electron.launch({ recordVideo })), not where the config says.
          surface, run, videos: null, screenshots: null,
          videoProblem: "set e2e.desktop.videos to the folder the Electron tests record into (`_electron.launch({ recordVideo: { dir } })`); Playwright's config doesn't say",
          shotsProblem: "set e2e.desktop.screenshots to the folder the Electron tests save screenshots in",
        }
        : {
          surface, run, videos: folder, screenshots: folder,
          videoProblem: out === null
            ? `set e2e.web.videos: outputDir in ${name} is ${code(outExpr!)}, ${NO_DEFAULT}`
            : video ? null : `turn videos on in ${name} (use: { video: "on" })`,
          shotsProblem: out === null ? `set e2e.web.screenshots: outputDir in ${name} is ${code(outExpr!)}, ${NO_DEFAULT}` : null,
        }))
    }
  }
  if (deps.has("cypress")) {
    const config = Object.entries(facts.texts).find(([p]) => basename(p).startsWith("cypress.config."))?.[1] ?? ""
    e2e.push(entry("Cypress", /\bcypress\s+run\b/, {
      surface: "web",
      run: scriptRunning(/cypress run/, ["test:e2e", "e2e", "cypress:run"]) ?? { command: runner.exec("cypress run"), body: null },
      videos: "cypress/videos",
      screenshots: "cypress/screenshots",
      videoProblem: /\bvideo:\s*true/.test(config) ? null : "turn videos on in cypress.config (video: true)",
    }))
  }
  if (has(facts, ".maestro")) {
    e2e.push(entry("Maestro", /maestro/, {
      surface: "mobile",
      run: { command: "maestro test .maestro", body: null },
      videos: null,
      screenshots: null,
      videoProblem: "record flows with `maestro record`",
    }))
  }
  if (deps.has("detox")) {
    e2e.push(entry("Detox", /\bdetox\s+test\b/, {
      surface: "mobile",
      run: scriptRunning(/detox test/, ["test:e2e", "e2e"]) ?? { command: runner.exec("detox test"), body: null },
      videos: "artifacts",
      screenshots: "artifacts",
      videoProblem: "run with --record-videos all",
    }))
  }
  // The first entry for each surface.
  const kept = e2e.filter((item, i) => e2e.findIndex((other) => other.surface === item.surface) === i)
  for (const item of kept) {
    fields[`e2e.${item.surface}.run`] = item.run.command
    if (item.videos) fields[`e2e.${item.surface}.videos`] = item.videos
    if (item.screenshots) fields[`e2e.${item.surface}.screenshots`] = item.screenshots
  }
  if (ui && kept.length > 0) fields["ui.runsIn"] = kept.some((item) => /docker/i.test(item.run.body ?? item.run.command)) ? "docker" : "local"

  // ── the app ──
  const unresolved: Array<{ field: string; why: string }> = []
  const startScript = firstScript(scripts, ["dev", "start"])
  if (js && startScript) fields["app.start"] = manager === "npm" && startScript === "start" ? "npm start" : js.script(startScript)
  const withBase = playwrightConfigs.map(([file, config]) => ({ file, config, expr: exprAfter(config, "baseURL") })).find((c) => c.expr !== null)
  const baseUrl = withBase ? evaluate(withBase.expr!, withBase.config) : null
  const port = startScript ? portOf(scripts[startScript]!, facts, stack) : null
  if (baseUrl !== null && /^https?:\/\//.test(baseUrl)) fields["app.url"] = baseUrl
  else if (port && "port" in port) fields["app.url"] = `http://localhost:${port.port}`
  else if (withBase) unresolved.push({ field: "app.url", why: `baseURL in ${withBase.file} is ${code(withBase.expr!)}, ${NO_DEFAULT}` })
  else if (port) unresolved.push({ field: "app.url", why: port.why })

  if (ui) fields["evidence.ui"] = UI_EVIDENCE
  if (stack.length > 0) fields["evidence.cli"] = CLI_EVIDENCE

  // Last guard: a value with a variable still in it can't be opened or run as written, so it isn't written (CEL-96).
  for (const [field, value] of Object.entries(fields)) {
    if (!/\$\{|process\.env\b/.test(value)) continue
    delete fields[field]
    unresolved.push({ field, why: `the value found, \`${value}\`, names a variable` })
  }

  // ── readiness ──
  const playwright = e2e.some((item) => item.tool === "Playwright")
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
    const first = kept[0]!
    const problems = [
      ...kept.flatMap((item) => (item.videoProblem ? [item.videoProblem] : [])),
      ...(playwright && !machine.playwrightBrowsers ? ["download a browser with `npx playwright install chromium`"] : []),
      ...(!machine.ffmpeg ? ["install ffmpeg to turn the videos into MP4"] : []),
      ...(fields["ui.runsIn"] === "docker" && !machine.docker ? ["install or start Docker: the e2e runs in it"] : []),
    ]
    const runs = kept.length > 1 ? kept.map((item) => `${item.run.command} (${item.surface})`).join(", ") : first.run.command
    add("e2e video", problems.length ? "partial" : "ready", `${unique(e2e.map((item) => item.tool)).join(", ")}: ${runs}`,
      problems.length ? `${problems.join("; ")}.` : null)
    const shotsProblems = [
      ...kept.flatMap((item) => (item.shotsProblem ? [item.shotsProblem] : [])),
      ...(playwright && !machine.playwrightBrowsers ? ["download a browser with `npx playwright install chromium`"] : []),
    ]
    const saved = unique(kept.flatMap((item) => (item.screenshots ? [item.screenshots] : [])))
    const shots = shotsProblems.join("; ")
    add("screenshots", shots ? "partial" : "ready", saved.length ? `saved in ${saved.join(", ")}` : `${first.tool} can take them`,
      shots ? `${shots[0]!.toUpperCase()}${shots.slice(1)}.` : null)
  }

  const anything = unitCommand ?? fields["app.start"] ?? fields["typecheck"]
  add("terminal transcript", anything ? "ready" : "partial", anything ? "commands to run and save with their output" : "nothing to run yet",
    anything ? null : "Add a test script, so a transcript of it can show the change working.")

  return {
    stack,
    packageManager: js?.name ?? python?.name ?? (go ? "go" : rust ? "cargo" : null),
    tools: { unit: unitRunner, e2e: unique(e2e.map((item) => item.tool)) },
    fields,
    unresolved,
    readiness,
  }
}
