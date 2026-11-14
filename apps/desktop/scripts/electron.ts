// The Electron binary for dev and tests. Bun doesn't run Electron's postinstall (it isn't a trusted
// dependency), so the first call runs its install script, which takes the zip from Electron's
// download cache (~/Library/Caches/electron) when it's there.
import * as fs from "node:fs"
import * as path from "node:path"

export const desktopDir = path.join(import.meta.dir, "..")

export const electronBinary = (): string => {
  const pkg = path.dirname(Bun.resolveSync("electron/package.json", desktopDir))
  const pathFile = path.join(pkg, "path.txt")
  if (!fs.existsSync(pathFile)) {
    const result = Bun.spawnSync([process.execPath, path.join(pkg, "install.js")], { cwd: pkg, stdout: "inherit", stderr: "inherit" })
    if (result.exitCode !== 0) throw new Error("Couldn't install the Electron binary (node_modules/electron/install.js failed).")
  }
  return path.join(pkg, "dist", fs.readFileSync(pathFile, "utf8").trim())
}
