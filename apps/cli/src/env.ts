// Everything a command reads from the outside world, as a service, so tests run commands in-process.
import * as os from "node:os"
import * as path from "node:path"
import type { WebFiles } from "@cello/server/web/WebFiles"
import * as Context from "effect/Context"
import type { Env } from "./identity.ts"

/** The build this `cello` is (CEL-37): `--version`, `cello whoami`, and the commit `cello start` reports. */
export interface CliBuild {
  /** The git commit it was built from; null when unknown. */
  readonly commit: string | null
}

export class CliEnv extends Context.Service<CliEnv, {
  readonly env: Env
  readonly cwd: string
  readonly now: () => number
  readonly readStdin: () => Promise<string>
  /** The built web app for `cello start`: embedded in the binary, or apps/web/dist from source. */
  readonly web: () => WebFiles | undefined
  /** This binary's build; tests may leave it out (no commit then). */
  readonly build?: CliBuild
  /**
   * Ends the process (the binary passes process.exit). The hook calls it so a stdin that never closes
   * can't keep it alive; tests leave it out.
   */
  readonly exit?: (code: number) => void
}>()("cello/CliEnv") {}

/** The server's port: CELLO_PORT, else 4747. */
export const portOf = (env: Env): number => Number(env.CELLO_PORT || 4747)

/** The data folder `cello start` serves: CELLO_DATA_DIR, else ~/.cello. */
export const dataDirOf = (env: Env): string => path.resolve(env.CELLO_DATA_DIR || path.join(env.HOME || os.homedir(), ".cello"))
