// Runs Cello's tests in a throwaway Linux container (Docker, through OrbStack on Lucas's Mac), so UI
// tests never open a window on his screen: the desktop app's Electron runs under Xvfb in there. The
// worktree you run it from is mounted read-only and copied inside; results come back to
// test-results/docker/. Follows focus-extension's scripts/run-in-container.mjs.
//
//   bun run test:docker                      unit + integration, typecheck, web e2e, desktop e2e
//   bun run test:docker:e2e [-- <args>]      web e2e only; args go to `playwright test`
//   bun run test:docker:desktop [-- <args>]  desktop e2e only
//
// Each run gets its own folder, test-results/docker/<time>-<label>-<pid>/ (scripts/docker/runFolders.ts),
// with summary.txt, logs/, web/videos (MP4), desktop/videos (MP4) and desktop/screenshots;
// test-results/docker/latest points at the newest. The label is the mode, or CELLO_TEST_LABEL.
// TEST_CPUS and TEST_MEMORY change the 4 CPU and 6 GB caps. CELLO_E2E_SLOWMO and CELLO_E2E_ONLINE
// are passed in. The image (docker/test.Dockerfile) is built on the first run and again only when
// the Dockerfile or the pinned Playwright or Bun version changes.
import { spawn, spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { buildArgs, dockerArgs, imageTag, parseCommand, passedEnv, versions } from "./docker/container.ts"
import { finishRun, startRun } from "./docker/runFolders.ts"
import { duration, parseSteps, summarize } from "./docker/summary.ts"

const repo = path.resolve(import.meta.dir, "..")

const docker = (args: ReadonlyArray<string>, inherit = false) =>
  spawnSync("docker", args, { stdio: inherit ? "inherit" : "ignore" }).status === 0

const git = (...args: string[]) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" }).stdout?.trim() ?? ""

/** Files with `ext` in `dir`, 0 when it's missing. */
const countFiles = (dir: string, ext: string) => {
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith(ext)).length
  } catch {
    return 0
  }
}

const read = (file: string) => {
  try {
    return fs.readFileSync(file, "utf8")
  } catch {
    return ""
  }
}

const parsed = parseCommand(process.argv.slice(2))
if ("error" in parsed) {
  console.error(parsed.error)
  process.exit(2)
}
const { mode, args } = parsed

if (!docker(["info"])) {
  console.error("Docker isn't running. Start OrbStack (`open -a OrbStack`, or Docker Desktop) and try again.")
  process.exit(1)
}

const pinned = versions(repo)
const dockerfile = path.join(repo, "docker/test.Dockerfile")
const image = imageTag({ dockerfile: fs.readFileSync(dockerfile, "utf8"), ...pinned })
if (!docker(["image", "inspect", image])) {
  console.log(`Building the test image ${image} (Playwright ${pinned.playwright}, Bun ${pinned.bun}); only when it changes…`)
  const buildStart = Date.now()
  if (!docker(buildArgs({ tag: image, dockerfile, ...pinned }), true)) {
    console.error(`Couldn't build ${image} from docker/test.Dockerfile.`)
    process.exit(1)
  }
  console.log(`Built ${image} in ${duration(Math.round((Date.now() - buildStart) / 1000))}.`)
}

const cpus = process.env.TEST_CPUS ?? "4"
const memory = process.env.TEST_MEMORY ?? "6g"
// A fresh folder per run: OrbStack can keep a deleted folder mounted, so a run never empties or replaces one.
const out = await startRun(path.join(repo, "test-results/docker"), process.env.CELLO_TEST_LABEL || mode)
const folder = path.relative(repo, out)
const started = new Date()
console.log(`Running ${[mode, ...args].join(" ")} in ${image} (${cpus} CPUs, ${memory}); results in ${folder}/`)

// Ctrl+C (or a kill) stops the container by its name; this process stays to write the summary.
const name = `cello-test-${path.basename(out)}`
const stop = () => spawnSync("docker", ["kill", name], { stdio: "ignore" })
process.on("SIGINT", stop)
process.on("SIGTERM", stop)
const status = await new Promise<number | null>((resolve) => {
  const child = spawn("docker", dockerArgs({ image, name, mode, args, repo, out, cpus, memory, env: process.env }), { stdio: "inherit" })
  child.once("error", () => resolve(null))
  child.once("exit", (code) => resolve(code))
})

const steps = parseSteps(read(path.join(out, "steps.tsv")))
const summary = summarize({
  mode,
  args,
  started,
  seconds: Math.round((Date.now() - started.getTime()) / 1000),
  image,
  repo,
  commit: `${git("rev-parse", "--short", "HEAD")} on ${git("rev-parse", "--abbrev-ref", "HEAD")}${git("status", "--porcelain") ? " with uncommitted changes" : ""}`,
  limits: `${cpus} CPUs, ${memory} memory`,
  env: passedEnv(process.env),
  steps,
  logs: Object.fromEntries(steps.map((step) => [step.name, read(path.join(out, "logs", `${step.name}.log`))])),
  files: {
    "web/videos": countFiles(path.join(out, "web/videos"), ".mp4"),
    "desktop/videos": countFiles(path.join(out, "desktop/videos"), ".mp4"),
    "desktop/screenshots": countFiles(path.join(out, "desktop/screenshots"), ".png"),
  },
})
fs.writeFileSync(path.join(out, "summary.txt"), summary)
await finishRun(out)
console.log(`\n${summary}\nResults: ${folder}/  (test-results/docker/latest is the newest run)`)
process.exit(status ?? 1)
