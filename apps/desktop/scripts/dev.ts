// `bun run dev`: builds the app and runs it with Electron. It joins the server already running on
// CELLO_PORT (4747 by default, e.g. `cello start` in a terminal), or starts apps/cli/dist/cello.
import * as path from "node:path"
import { desktopDir, electronBinary } from "./electron.ts"

const build = Bun.spawnSync([process.execPath, path.join(desktopDir, "scripts/build.ts")], { stdout: "inherit", stderr: "inherit" })
if (build.exitCode !== 0) process.exit(build.exitCode ?? 1)

const electron = Bun.spawn([electronBinary(), desktopDir, ...process.argv.slice(2)], { stdout: "inherit", stderr: "inherit" })
process.exit(await electron.exited)
