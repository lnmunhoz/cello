// The project folder for a working directory is the main checkout (`repoRootFor`, shared with the
// server, which normalizes project paths the same way); the checkout itself is where repo files go.
import * as fs from "node:fs"

export { repoRootFor } from "@cello/server/project/repoPath"

/** The checkout a working directory is in (`git rev-parse --show-toplevel`): a linked worktree is its own. */
export const checkoutRootFor = (cwd: string): string | null => {
  const result = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd, stdout: "pipe", stderr: "ignore" })
  if (result.exitCode !== 0) return null
  return fs.realpathSync(result.stdout.toString().trim())
}
