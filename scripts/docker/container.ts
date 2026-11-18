// What scripts/test-in-docker.ts asks Docker for: the test image (built from docker/test.Dockerfile,
// tagged by its inputs), the `docker run` arguments, and the script the container runs. Pure, so
// the tests check every argument without starting Docker.
import { createHash } from "node:crypto"
import * as fs from "node:fs"
import * as path from "node:path"
import { DOCKER_STEPS, type DockerMode } from "../../packages/domain/src/testRun.ts"
import { IN_CONTAINER } from "./guard.ts"

export type Mode = DockerMode

/**
 * The steps each mode runs, in order. `install` comes first and stops the run when it fails. Kept in
 * @cello/domain (testRun), where the server tells two runs apart by the stage their reports name (CEL-147).
 */
export const MODE_STEPS = DOCKER_STEPS

/**
 * Electron's window is 1440×900 and the tests run it at a device scale of 2 (apps/desktop/e2e/support.ts),
 * so the virtual screen has room for 2880×1800 pixels, in 24-bit colour (xvfb-run's default is 640×480×8).
 */
const SCREEN = "3200x2000x24"

/** Each step's command, run from the copy of the repo in /work. Playwright arguments go on the end. */
const COMMANDS: Readonly<Record<string, string>> = {
  install: "bun install --frozen-lockfile",
  unit: "bun run test",
  typecheck: "bun run typecheck",
  "web-e2e": "bun run test:e2e:local",
  "desktop-e2e": `cd apps/desktop && xvfb-run -a -s ${shellQuote(`-screen 0 ${SCREEN}`)} bun run test:e2e:local`,
}
const PLAYWRIGHT_STEPS = new Set(["web-e2e", "desktop-e2e"])

/**
 * Left out of the copy into the container: installs and builds (made again inside, for Linux),
 * git, results, other worktrees, data folders, and art renders. Bare names match at any depth;
 * `./` ones only at the repo root.
 */
export const EXCLUDES: ReadonlyArray<string> = [
  "node_modules", ".git", "dist", "dist-electron", "test-results", "playwright-report", ".cello",
  "./e2e/videos", "./.claude/worktrees", "./apps/cli/.build", "./art/promo", "./art/variations",
]

/** Passed into the container when set on the Mac: review videos, slow motion, and the online test. */
const PASSED_ENV = ["CELLO_E2E_REVIEW", "CELLO_E2E_SLOWMO", "CELLO_E2E_ONLINE"] as const

/** The variables from `env` that go into the container. */
export const passedEnv = (env: Readonly<Record<string, string | undefined>>): Record<string, string> =>
  Object.fromEntries(PASSED_ENV.flatMap((name) => (env[name] ? [[name, env[name]]] : [])))

const IMAGE_NAME = "cello-test"

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/** The pinned versions the image is built from: @playwright/test in package.json, Bun in .bun-version. */
export const versions = (repo: string): { playwright: string; bun: string } => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"))
  return {
    playwright: pkg.devDependencies["@playwright/test"],
    bun: fs.readFileSync(path.join(repo, ".bun-version"), "utf8").trim(),
  }
}

/** The image's tag: the versions to read, and a hash of them with the Dockerfile, so it's rebuilt only when one changes. */
export const imageTag = (inputs: { dockerfile: string; playwright: string; bun: string }): string => {
  const hash = createHash("sha256").update(JSON.stringify([inputs.dockerfile, inputs.playwright, inputs.bun])).digest("hex")
  return `${IMAGE_NAME}:pw${inputs.playwright}-bun${inputs.bun}-${hash.slice(0, 10)}`
}

/** `docker build` arguments. The context is docker/ alone, so nothing from the repo is sent. */
export const buildArgs = (options: { tag: string; playwright: string; bun: string; dockerfile: string }): string[] => [
  "build", "-t", options.tag, "-f", options.dockerfile,
  "--build-arg", `PLAYWRIGHT_VERSION=${options.playwright}`, "--build-arg", `BUN_VERSION=${options.bun}`,
  path.dirname(options.dockerfile),
]

/** `all`, `e2e` or `desktop`, then Playwright arguments (a leading `--` is dropped). */
export const parseCommand = (argv: ReadonlyArray<string>): { mode: Mode; args: string[] } | { error: string } => {
  const [mode, ...rest] = argv
  const args = rest[0] === "--" ? rest.slice(1) : rest
  if (mode !== "all" && mode !== "e2e" && mode !== "desktop") {
    return { error: "Usage: bun scripts/test-in-docker.ts all | e2e [playwright args] | desktop [playwright args]" }
  }
  if (mode === "all" && args.length > 0) {
    return { error: "The full run takes no Playwright arguments; pass them to `test:docker:e2e` or `test:docker:desktop`." }
  }
  return { mode, args }
}

/**
 * The script the container runs: copy the repo from the read-only mount into /work, install, run
 * the mode's steps, copy videos, screenshots and Playwright output to /out, and exit with the worst
 * status. Each step's output goes to /out/logs/<step>.log, and its exit code and time to
 * /out/steps.tsv, which the runner turns into summary.txt.
 */
export const containerScript = (mode: Mode, args: ReadonlyArray<string>): string => {
  const extra = args.map(shellQuote).join(" ")
  const step = (name: string) => {
    const command = PLAYWRIGHT_STEPS.has(name) && extra ? `${COMMANDS[name]} ${extra}` : COMMANDS[name]!
    return `step ${name} ${shellQuote(command)}${name === "install" ? " || exit 1" : ""}`
  }
  return [
    "set -u",
    "status=0",
    "mkdir -p /work /out/logs",
    "step() {",
    "  local name=$1 start=$SECONDS code",
    `  printf '\\n== %s\\n' "$name"`,
    `  bash -c "$2" 2>&1 | tee "/out/logs/$name.log"`,
    "  code=${PIPESTATUS[0]}",
    `  printf '%s\\t%s\\t%s\\n' "$name" "$code" "$((SECONDS - start))" >> /out/steps.tsv`,
    `  [ "$code" -eq 0 ] || status=1`,
    `  return "$code"`,
    "}",
    // tar exits 1 when a file changes while it's read (an editor saving on the Mac), so the copy is
    // checked by its result instead of by tar's status.
    `tar -C /src ${EXCLUDES.map((pattern) => `--exclude=${shellQuote(pattern)}`).join(" ")} --warning=no-file-changed -cf - . 2>/tmp/copy.log | tar -xf - -C /work 2>>/tmp/copy.log`,
    "cd /work",
    `[ -s bun.lock ] || { echo "Couldn't copy the repo into the container:"; cat /tmp/copy.log; exit 1; }`,
    ...MODE_STEPS[mode].map(step),
    "mkdir -p /out/web /out/desktop",
    "[ -d e2e/videos ] && cp -R e2e/videos /out/web/videos",
    "[ -d test-results/playwright ] && cp -R test-results/playwright /out/web/playwright",
    "[ -d apps/desktop/test-results ] && cp -R apps/desktop/test-results/. /out/desktop/",
    // Playwright's raw WebM recordings: the MP4s made from them are already there.
    "find /out/web /out/desktop -name '*.webm' -delete",
    "exit $status",
  ].join("\n")
}

export interface RunOptions {
  readonly image: string
  /** The container's name, so the runner can stop it (`docker kill`) on Ctrl+C. */
  readonly name: string
  readonly mode: Mode
  readonly args: ReadonlyArray<string>
  /** The worktree being tested, mounted read-only at /src. */
  readonly repo: string
  /** The run's results folder, mounted at /out. */
  readonly out: string
  readonly cpus: string
  readonly memory: string
  /** The Mac's environment; only PASSED_ENV is taken from it. */
  readonly env: Readonly<Record<string, string | undefined>>
}

/**
 * `docker run` arguments: the repo read-only, the results folder, caches for Bun's packages and
 * Electron's download, capped CPUs and memory, and the container's own network (no ports
 * published), so the tests' default ports never meet the Mac's.
 */
export const dockerArgs = (options: RunOptions): string[] => [
  "run", "--rm", "--init", `--cpus=${options.cpus}`, `--memory=${options.memory}`, "--shm-size=1g",
  "--name", options.name, "--label", IMAGE_NAME,
  "-v", `${options.repo}:/src:ro`,
  "-v", `${options.out}:/out`,
  "-v", `${IMAGE_NAME}-bun-cache:/root/.bun/install/cache`,
  "-v", `${IMAGE_NAME}-electron-cache:/root/.cache/electron`,
  "-e", `${IN_CONTAINER.name}=${IN_CONTAINER.value}`,
  ...Object.entries(passedEnv(options.env)).flatMap(([name, value]) => ["-e", `${name}=${value}`]),
  options.image, "bash", "-c", containerScript(options.mode, options.args),
]
