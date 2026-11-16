// The files a release attaches (CEL-36): the `cello` binary (apps/cli's build) and the unsigned Cello.app
// (apps/desktop's package script, bundling that same binary), each zipped into release/. Run by the release
// after its commit and tag, so the binary embeds the release commit and the new APP_VERSION.
// The binary is built into release/stage/cello, never over apps/cli/dist/cello: that's the live cello
// (~/.local/bin/cello and the background service run it), and only the deploy puts the new one there, after
// its backup (deploy.ts). Packaging never installs or opens the app.
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"

export type ArtifactOptions = {
  readonly root: string
  readonly version: string
  readonly platform: string
  readonly arch: string
  /** false with --skip-desktop: release without Cello.app. */
  readonly desktop: boolean
}

export type BuildStep = { readonly cwd: string; readonly cmd: ReadonlyArray<string>; readonly kind: "cli" | "app" }

export const RELEASE_DIR = "release"
/** Where the release's cello waits until the deploy puts it live. */
export const STAGED_CLI = `${RELEASE_DIR}/stage/cello`
/** Left by a failed Cello.app package, so the release's advice can offer --skip-desktop. */
export const PACKAGING_FAILED = `${RELEASE_DIR}/packaging-failed`
const SKIP_HINT = "bun run release -- --skip-desktop"

export const artifactNames = (version: string, platform: string, arch: string) => ({
  cli: `cello-v${version}-${platform}-${arch}.zip`,
  app: `Cello-v${version}-mac-${arch}.zip`,
})

export const artifactSteps = (options: ArtifactOptions): BuildStep[] => {
  const { root, version, platform, arch } = options
  const isMac = platform === "darwin"
  if (options.desktop && !(isMac && arch === "arm64")) {
    throw new Error(
      `Packaging Cello.app needs macOS on Apple silicon (this is ${platform}-${arch}). Release without it: ${SKIP_HINT}`,
    )
  }
  const names = artifactNames(version, platform, arch)
  const out = (name: string) => path.join(root, RELEASE_DIR, name)
  const cli = path.join(root, "apps/cli")
  const desktop = path.join(root, "apps/desktop")
  const staged = path.join(root, STAGED_CLI)
  const steps: BuildStep[] = [
    { kind: "cli", cwd: cli, cmd: ["bun", "run", "build", "--outfile", staged] },
    // Just `cello` at the zip's top, executable (zip keeps the mode); ditto would add a folder and ._ files.
    { kind: "cli", cwd: path.dirname(staged), cmd: ["zip", "-j", out(names.cli), "cello"] },
  ]
  if (options.desktop) {
    steps.push(
      { kind: "app", cwd: desktop, cmd: ["bun", "run", "package", "--cli", staged] },
      {
        kind: "app",
        cwd: path.join(desktop, "dist/mac-arm64"),
        // How Apple zips an app: symlinks inside Electron's frameworks and resource forks survive.
        cmd: ["ditto", "-c", "-k", "--sequesterRsrc", "--keepParent", "Cello.app", out(names.app)],
      },
    )
  }
  return steps
}

export type Run = (cmd: ReadonlyArray<string>, cwd: string) => number

const inherit: Run = (cmd, cwd) => spawnSync(cmd[0]!, cmd.slice(1), { cwd, stdio: "inherit" }).status ?? 1

/**
 * Empties release/, runs the steps in order, and returns the zips. At the first failing step it deletes
 * release/stage (a half-built or unreleased binary must never be deployed) and throws.
 */
export const buildArtifacts = (options: ArtifactOptions, run: Run = inherit): string[] => {
  const steps = artifactSteps(options)
  const dir = path.join(options.root, RELEASE_DIR)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(path.join(options.root, path.dirname(STAGED_CLI)), { recursive: true })
  for (const step of steps) {
    const code = run(step.cmd, step.cwd)
    if (code === 0) continue
    fs.rmSync(path.join(options.root, path.dirname(STAGED_CLI)), { recursive: true, force: true })
    const what = `${step.cmd.join(" ")} exited ${code}`
    if (step.kind === "app") {
      fs.writeFileSync(path.join(options.root, PACKAGING_FAILED), `${what}\n`)
      throw new Error(`Packaging Cello.app failed (${what}). Fix it, or release without it: ${SKIP_HINT}`)
    }
    throw new Error(`Building the cello binary failed (${what}).`)
  }
  const names = artifactNames(options.version, options.platform, options.arch)
  return [names.cli, ...(options.desktop ? [names.app] : [])].map((name) => path.join(dir, name))
}
