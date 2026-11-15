// Everything a command reads from the outside world, as a service, so tests run commands in-process.
import * as os from "node:os"
import * as path from "node:path"
import type { WebFiles } from "@cello/server/web/WebFiles"
import * as Context from "effect/Context"
import type { Env } from "./identity.ts"

export class CliEnv extends Context.Service<CliEnv, {
  readonly env: Env
  readonly cwd: string
  readonly now: () => number
  readonly readStdin: () => Promise<string>
  /** The built web app for `cello start`: embedded in the binary, or apps/web/dist from source. */
  readonly web: () => WebFiles | undefined
}>()("cello/CliEnv") {}

/** The server's port: CELLO_PORT, else 4747. */
export const portOf = (env: Env): number => Number(env.CELLO_PORT || 4747)

/** The data folder `cello start` serves: CELLO_DATA_DIR, else ~/.cello. */
export const dataDirOf = (env: Env): string => path.resolve(env.CELLO_DATA_DIR || path.join(env.HOME || os.homedir(), ".cello"))
