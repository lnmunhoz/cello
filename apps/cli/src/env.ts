// Everything a command reads from the outside world, as a service, so tests run commands in-process.
import * as os from "node:os"
import * as path from "node:path"
import type { WebFiles } from "@cello/server/web/WebFiles"
import type { Flavor } from "@cello/shared/flavor"
import * as Context from "effect/Context"
import type { Env } from "./identity.ts"

/** The build this `cello` is (CEL-37): `--version`, `cello whoami`, and the commit `cello start` reports. */
export interface CliBuild {
  /** The git commit it was built from; null when unknown. */
  readonly commit: string | null
  /**
   * The git checkout it was built from, where `cello start` reads the commits merged between builds for
   * the build history (CEL-50); left out when unknown. A compiled binary carries the path it was built in.
   */
  readonly checkout?: string | undefined
  /**
   * Which Cello it is (CEL-149): `dev` for the `cello` built on this Mac (`bun run release` deploys it, and
   * Cello Dev.app bundles it), whose links are `cello-dev://`; `release` for the download. scripts/build.ts
   * embeds it; left out (from source, in tests) it's `release`.
   */
  readonly flavor?: Flavor | undefined
}

/** The flavor of this build: `release` unless the binary was built as `dev`. */
export const flavorOf = (build: CliBuild | undefined): Flavor => build?.flavor ?? "release"

export class CliEnv extends Context.Service<CliEnv, {
  readonly env: Env
  readonly cwd: string
  readonly now: () => number
  readonly readStdin: () => Promise<string>
  /** The built web app for `cello start`: embedded in the binary, or apps/web/dist from source. */
  readonly web: () => WebFiles | undefined
  /**
   * Hands a link to the system to open (`cello open`, CEL-88): `open` on macOS, `xdg-open` on Linux
   * for the binary (open.ts), a fake in tests, so a test never opens anything.
   */
  readonly open: (link: string) => Promise<void>
  /**
   * The command that runs this `cello` (service.ts's selfCommand): the compiled binary, or bun and
   * bin.ts. `cello service install` puts it in the plist; tests that install pass a stand-in.
   */
  readonly self?: ReadonlyArray<string>
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
