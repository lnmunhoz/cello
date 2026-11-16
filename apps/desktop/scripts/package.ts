// `bun run package`: an unsigned Cello.app for Apple silicon in dist/mac-arm64/, with the compiled
// `cello` binary (and the web app it embeds) at Contents/Resources/cello. Builds the CLI first;
// `--skip-cli` reuses apps/cli/dist/cello as it is; `--cli <binary>` bundles that binary instead. `--install` also copies the app to /Applications, where
// Launchpad, Spotlight and Raycast list it (they don't look in dist/), then unregisters the build folders'
// copies from LaunchServices so cello:// links open /Applications' copy, and warns about a Cello still
// running an old build (install.ts).
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { bundlingCli } from "../src/install/builderConfig.ts"
import { INSTALLED_APP } from "../src/install/plan.ts"
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
if (cliBinary === null && !process.argv.includes("--skip-cli")) run([process.execPath, "run", "build"], cliDir)
const bundled = cliBinary ?? path.join(cliDir, "dist/cello")
if (!fs.existsSync(bundled)) {
  throw new Error(cliBinary ? `No cello binary at ${cliBinary}.` : "No apps/cli/dist/cello: run bun run build in apps/cli.")
}
let builderConfig = "electron-builder.json"
if (cliBinary) {
  const config = JSON.parse(fs.readFileSync(path.join(desktopDir, builderConfig), "utf8"))
  builderConfig = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cello-package-")), "electron-builder.json")
  fs.writeFileSync(builderConfig, JSON.stringify(bundlingCli(config, cliBinary), null, 2))
}

run([process.execPath, path.join(desktopDir, "scripts/build.ts")], desktopDir)
// No signing identity: the app is unsigned (macOS asks to confirm the first launch).
run([path.join(desktopDir, "node_modules/.bin/electron-builder"), "--mac", "--config", builderConfig], desktopDir, {
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
})

const app = path.join(desktopDir, "dist/mac-arm64/Cello.app")
// Copied along with the Electron distribution; the app never falls back to Electron's demo app.
fs.rmSync(path.join(app, "Contents/Resources/default_app.asar"), { force: true })
const size = Bun.spawnSync(["du", "-sh", app]).stdout.toString().split("\t")[0]
console.log(`Packaged ${app} (${size})`)

if (process.argv.includes("--install")) {
  const installed = INSTALLED_APP
  // A Cello started before this moment runs the build being replaced.
  const installedAt = new Date()
  // Copied beside it first, and swapped in only once the copy succeeded: a failed ditto leaves the old
  // app in place, never no app. Quit Cello first if it runs from /Applications: the swap replaces it.
  const staged = path.join(path.dirname(installed), ".Cello.app.new")
  run(["rm", "-rf", staged], desktopDir)
  run(["ditto", app, staged], desktopDir)
  run(["rm", "-rf", installed], desktopDir)
  run(["mv", staged, installed], desktopDir)
  run(["touch", installed], desktopDir)
  console.log(`Installed ${installed}`)
  afterInstall(installed, installedAt)
}
