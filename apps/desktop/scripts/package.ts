// `bun run package`: an unsigned Cello.app for Apple silicon in dist/mac-arm64/, with the compiled
// `cello` binary (and the web app it embeds) at Contents/Resources/cello. Builds the CLI first;
// `--skip-cli` reuses apps/cli/dist/cello as it is.
import * as fs from "node:fs"
import * as path from "node:path"
import { desktopDir } from "./electron.ts"

const run = (cmd: string[], cwd: string, env: Record<string, string> = {}) => {
  const result = Bun.spawnSync(cmd, { cwd, env: { ...process.env, ...env }, stdout: "inherit", stderr: "inherit" })
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1)
}

const cliDir = path.join(desktopDir, "../cli")
if (!process.argv.includes("--skip-cli")) run([process.execPath, "run", "build"], cliDir)
if (!fs.existsSync(path.join(cliDir, "dist/cello"))) throw new Error("No apps/cli/dist/cello: run bun run build in apps/cli.")

run([process.execPath, path.join(desktopDir, "scripts/build.ts")], desktopDir)
// No signing identity: the app is unsigned (macOS asks to confirm the first launch).
run([path.join(desktopDir, "node_modules/.bin/electron-builder"), "--mac", "--config", "electron-builder.json"], desktopDir, {
  CSC_IDENTITY_AUTO_DISCOVERY: "false",
})

const app = path.join(desktopDir, "dist/mac-arm64/Cello.app")
// Copied along with the Electron distribution; the app never falls back to Electron's demo app.
fs.rmSync(path.join(app, "Contents/Resources/default_app.asar"), { force: true })
const size = Bun.spawnSync(["du", "-sh", app]).stdout.toString().split("\t")[0]
console.log(`Packaged ${app} (${size})`)
