// A temp folder for a test's data, removed when the scope closes.
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as Effect from "effect/Effect"

export const tempDataDir = Effect.acquireRelease(
  Effect.sync(() => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cello-test-")))),
  (dir) => Effect.sync(() => fs.rmSync(dir, { recursive: true, force: true })),
)
