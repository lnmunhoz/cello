// What a release builds (CEL-36, CEL-139), after its commit and tag, so every binary embeds the release commit
// and the new APP_VERSION:
//   - on this Mac, every release: its own `cello`, into release/stage/cello, for the deploy. It's the dev flavor
//     (CEL-149): its links are cello-dev://, which Cello Dev.app (the Mac's own build) opens.
//   - the downloads: the `cello` zip, plus Cello.app (apps/desktop's package script, bundling that same binary)
//     as a DMG and a zip, into release/. They're the release flavor (`--flavor release`, cello:// links, the
//     Cello.app people install), built into release/download/cello. GitHub Actions builds them for each
//     architecture on a Mac of that kind (.github/workflows/release.yml runs `bun scripts/release/hooks.ts
//     artifacts`); this Mac builds its own only with `bun run release -- --local-artifacts`.
// The binary is built into release/stage/cello, never over apps/cli/dist/cello: that's the live cello
// (~/.local/bin/cello and the background service run it), and only the deploy puts the new one there, after
// its backup (deploy.ts). Packaging never installs or opens the app.
import { spawnSync } from "node:child_process"
import * as fs from "node:fs"
import * as path from "node:path"
import { packagedApp } from "../../apps/desktop/src/install/builderConfig.ts"

export type ArtifactOptions = {
  readonly root: string
  readonly version: string
  readonly platform: string
  readonly arch: string
  /** This Mac's own cello (a Cello Dev build), staged for the deploy: every `bun run release`, never GitHub Actions. */
  readonly deploy: boolean
  /** The downloads (release flavor): GitHub Actions, or this Mac with --local-artifacts. */
  readonly downloads: boolean
  /** With the downloads: Cello.app as well (false with --skip-desktop). */
  readonly desktop: boolean
  /** Sign (and notarize) Cello.app: the workflow, when its signing secrets exist. */
  readonly sign: boolean
}

export type BuildStep = { readonly cwd: string; readonly cmd: ReadonlyArray<string>; readonly kind: "cli" | "app" }

export const RELEASE_DIR = "release"
/** Where the release's cello for this Mac (dev flavor) waits until the deploy puts it live. */
export const STAGED_CLI = `${RELEASE_DIR}/stage/cello`
/** The downloads' cello (release flavor): zipped, and bundled into Cello.app. */
export const DOWNLOAD_CLI = `${RELEASE_DIR}/download/cello`
/** Left by a failed Cello.app package, so the release's advice can offer --skip-desktop. */
export const PACKAGING_FAILED = `${RELEASE_DIR}/packaging-failed`
const SKIP_HINT = "bun run release -- --local-artifacts --skip-desktop"

/** The downloads' file names; electron-builder.json's mac.artifactName gives the DMG and app zip the same. */
export const artifactNames = (version: string, platform: string, arch: string) => ({
  cli: `cello-v${version}-${platform}-${arch}.zip`,
  dmg: `Cello-v${version}-mac-${arch}.dmg`,
  app: `Cello-v${version}-mac-${arch}.zip`,
})

export const artifactSteps = (options: ArtifactOptions): BuildStep[] => {
  const { root, version, platform, arch } = options
  const desktop = options.downloads && options.desktop
  if (desktop && platform !== "darwin") {
    throw new Error(`Packaging Cello.app needs macOS (this is ${platform}-${arch}). Release without it: ${SKIP_HINT}`)
  }
  const names = artifactNames(version, platform, arch)
  const out = (name: string) => path.join(root, RELEASE_DIR, name)
  const cliDir = path.join(root, "apps/cli")
  const desktopDir = path.join(root, "apps/desktop")
  if (!options.deploy && !options.downloads) throw new Error("A release build makes this Mac's cello, the downloads, or both.")
  // Bun's names for the machine match Node's (darwin, linux; arm64, x64).
  const target = ["--target", `bun-${platform}-${arch}`]
  const steps: BuildStep[] = []
  if (options.deploy) {
    steps.push({ kind: "cli", cwd: cliDir, cmd: ["bun", "run", "build", "--outfile", path.join(root, STAGED_CLI), ...target, "--flavor", "dev"] })
  }
  if (!options.downloads) return steps
  const download = path.join(root, DOWNLOAD_CLI)
  // The web app is the same for both flavors: built once, by the first build.
  const skipWeb = options.deploy ? ["--skip-web"] : []
  steps.push(
    { kind: "cli", cwd: cliDir, cmd: ["bun", "run", "build", "--outfile", download, ...target, "--flavor", "release", ...skipWeb] },
    // Just `cello` at the zip's top, executable (zip keeps the mode); ditto would add a folder and ._ files.
    { kind: "cli", cwd: path.dirname(download), cmd: ["zip", "-j", out(names.cli), "cello"] },
  )
  if (desktop) {
    steps.push(
      {
        kind: "app",
        cwd: desktopDir,
        cmd: ["bun", "run", "package", "--cli", download, "--arch", arch, "--artifacts", "--flavor", "release", ...(options.sign ? ["--sign"] : [])],
      },
      // Signed ad hoc or with a Developer ID, every file must match the seal: a broken one is what macOS calls
      // "damaged" on a downloaded copy, so it fails the build here instead.
      {
        kind: "app",
        cwd: desktopDir,
        cmd: ["codesign", "--verify", "--deep", "--strict", "--verbose=2", packagedApp(arch === "x64" ? "x64" : "arm64", "release")],
      },
      { kind: "app", cwd: desktopDir, cmd: ["mv", `dist/${names.dmg}`, out(names.dmg)] },
      { kind: "app", cwd: desktopDir, cmd: ["mv", `dist/${names.app}`, out(names.app)] },
    )
  }
  return steps
}

export type Run = (cmd: ReadonlyArray<string>, cwd: string) => number

const inherit: Run = (cmd, cwd) => spawnSync(cmd[0]!, cmd.slice(1), { cwd, stdio: "inherit" }).status ?? 1

/**
 * Empties release/, runs the steps in order, and returns the downloads (none for the release's own cello).
 * At the first failing step it deletes release/stage and release/download (a half-built or unreleased binary must never be
 * deployed) and throws.
 */
export const buildArtifacts = (options: ArtifactOptions, run: Run = inherit): string[] => {
  const steps = artifactSteps(options)
  const dir = path.join(options.root, RELEASE_DIR)
  fs.rmSync(dir, { recursive: true, force: true })
  const built = [...(options.deploy ? [STAGED_CLI] : []), ...(options.downloads ? [DOWNLOAD_CLI] : [])].map((file) => path.join(options.root, path.dirname(file)))
  for (const folder of built) fs.mkdirSync(folder, { recursive: true })
  for (const step of steps) {
    const code = run(step.cmd, step.cwd)
    if (code === 0) continue
    for (const folder of built) fs.rmSync(folder, { recursive: true, force: true })
    const what = `${step.cmd.join(" ")} exited ${code}`
    if (step.kind === "app") {
      fs.writeFileSync(path.join(options.root, PACKAGING_FAILED), `${what}\n`)
      throw new Error(`Packaging Cello.app failed (${what}). Fix it, or release without it: ${SKIP_HINT}`)
    }
    throw new Error(`Building the cello binary failed (${what}).`)
  }
  if (!options.downloads) return []
  const names = artifactNames(options.version, options.platform, options.arch)
  return [names.cli, ...(options.desktop ? [names.dmg, names.app] : [])].map((name) => path.join(dir, name))
}
