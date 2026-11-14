// Before the run: the compiled `cello` binary (with the web app) and the bundled desktop app must exist.
import { execFileSync } from "node:child_process"
import * as fs from "node:fs"
import { CELLO_BIN, CLI_DIR, DESKTOP_DIR } from "./support.ts"

export default function setup() {
  if (!fs.existsSync(CELLO_BIN)) execFileSync("bun", ["run", "build"], { cwd: CLI_DIR, stdio: "inherit" })
  if (!fs.existsSync(`${DESKTOP_DIR}/dist-electron/main.cjs`)) execFileSync("bun", ["scripts/build.ts"], { cwd: DESKTOP_DIR, stdio: "inherit" })
}
