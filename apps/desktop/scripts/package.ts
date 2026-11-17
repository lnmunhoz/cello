// `bun run package`: Cello Dev.app (CEL-149: the Mac's own build, beside the downloaded Cello.app) signed ad hoc,
// for Apple silicon, in dist/mac-arm64/, with the compiled `cello` binary (and the web app it embeds) at
// Contents/Resources/cello. `--flavor release` packages Cello.app instead (`--artifacts` does by default).
// Builds the CLI first, as the same flavor; `--skip-cli` reuses apps/cli/dist/cello as it is; `--cli <binary>`
// bundles that binary instead. `--install` also copies the app to /Applications (Cello Dev.app), where
// Launchpad, Spotlight and Raycast list it (they don't look in dist/), then unregisters the build folders'
// copies from LaunchServices so cello-dev:// links open /Applications' copy, and warns about a Cello Dev still
// running an old build (install.ts). It never touches another app in /Applications.
// For a release (CEL-139; src/install/builderConfig.ts): `--arch x64` packages for Intel (in dist/mac/; run it on
// an Intel Mac, since it bundles this machine's Electron), `--artifacts` also makes Cello-v<version>-mac-<arch>.dmg
// and .zip in dist/, and `--sign` signs with CSC_LINK's certificate (and notarizes when APPLE_API_* are set).
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { bundlingCli, packagedApp, packagingConfig, parsePackaging } from "../src/install/builderConfig.ts"
import { appIdentity } from "../src/flavor.ts"
import { desktopDir } from "./electron.ts"
import { afterInstall } from "./install.ts"

const run = (cmd: string[], cwd: string, env: Record<string, string> = {}) => {
  const result = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1)
}

const cliDir = path.join(desktopDir, "../cli")
// `--cli <binary>` bundles that build (a release's staged one, CEL-36) and builds no CLI.
const cliFlag = process.argv.indexOf("--cli")
const cliBinary = cliFlag === -1 ? null : path.resolve(process.argv[cliFlag + 1] ?? "")
const packaging = parsePackaging(process.argv)
const identity = appIdentity(packaging.flavor)
// The bundled `cello` is built as the same flavor, so its links open this app (cello-dev:// for Cello Dev).
if (cliBinary === null && !process.argv.includes("--skip-cli")) run([process.execPath, "run", "build", "--flavor", packaging.flavor], cliDir)
const bundled = cliBinary ?? path.join(cliDir, "dist/cello")
if (!fs.existsSync(bundled)) {
  throw new Error(cliBinary ? `No cello binary at ${cliBinary}.` : "No apps/cli/dist/cello: run bun run build in apps/cli.")
}
const source = JSON.parse(fs.readFileSync(path.join(desktopDir, "electron-builder.json"), "utf8"))
const config = packagingConfig(cliBinary ? bundlingCli(source, cliBinary) : source, packaging)
// Relative paths in it (dist, resources, the afterPack hook) resolve against apps/desktop, electron-builder's cwd.
const builderConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cello-package-")), "electron-builder.json")
fs.writeFileSync(builderConfig, JSON.stringify(config, null, 2))

run([process.execPath, path.join(desktopDir, "scripts/build.ts"), "--flavor", packaging.flavor], desktopDir)
// Signed ad hoc unless --sign, never with a Developer ID it finds in the keychain (macOS asks to confirm the
// first launch). Signed, electron-builder takes the certificate from CSC_LINK / CSC_KEY_PASSWORD.
// CSC_FOR_PULL_REQUEST: electron-builder skips all signing when GITHUB_BASE_REF is set (a pull request's
// workflow run), which would leave the bundle's seal broken; those runs never get the signing secrets anyway.
run([path.join(desktopDir, "node_modules/.bin/electron-builder"), "--mac", "--config", builderConfig], desktopDir, {
  CSC_FOR_PULL_REQUEST: "true",
  ...(packaging.sign ? {} : { CSC_IDENTITY_AUTO_DISCOVERY: "false" }),
})

// Electron's demo app is already gone: scripts/after-pack.cjs removes it before signing and the DMG.
const app = path.join(desktopDir, packagedApp(packaging.arch, packaging.flavor))
const size = Bun.spawnSync(["du", "-sh", app]).stdout.toString().split("\t")[0]
console.log(`Packaged ${app} (${size})`)

if (process.argv.includes("--install")) {
  const installed = identity.installedApp
  // A Cello started before this moment runs the build being replaced.
  const installedAt = new Date()
  // Copied beside it first, and swapped in only once the copy succeeded: a failed ditto leaves the old
  // app in place, never no app. Quit Cello first if it runs from /Applications: the swap replaces it.
  const staged = path.join(path.dirname(installed), `.${path.basename(installed)}.new`)
  run(["rm", "-rf", staged], desktopDir)
  run(["ditto", app, staged], desktopDir)
  run(["rm", "-rf", installed], desktopDir)
  run(["mv", staged, installed], desktopDir)
  run(["touch", installed], desktopDir)
  console.log(`Installed ${installed}`)
  afterInstall(identity, installedAt)
}
