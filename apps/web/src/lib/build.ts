// The build this tab was loaded with (CEL-37), and reloading into the server's.
import { buildKey, type BuildStamp, type RunningBuild } from "@cello/shared/build"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { useAtomValue } from "@effect/atom-react"
import type { ServerBuild } from "@cello/contract/build"
import { serverBuildAtom } from "./cello.ts"
import { rememberReload } from "./reloadGuard.ts"

export { reloadedFor } from "./reloadGuard.ts"

/** Stamped into the bundle by apps/web/buildStamp.ts; null where it isn't (unit tests). */
export const loadedBuild: BuildStamp | null = typeof __CELLO_BUILD__ === "undefined" ? null : __CELLO_BUILD__

/** Reloads the page to bring in `served`, remembering that it did. */
export const reloadInto = (served: BuildStamp): void => {
  rememberReload(buildKey(served))
  location.reload()
}

/** The server's build, the last one heard (kept while reconnecting); null until the first answer. */
export const useServerBuild = (): ServerBuild | null => Option.getOrNull(AsyncResult.value(useAtomValue(serverBuildAtom)))

/** The running build as the footer and Settings name it: the server's own commit, else its web build's (a server run from a folder without git). */
export const runningBuild = (build: ServerBuild): RunningBuild => ({ ...build, commit: build.commit ?? build.web?.commit ?? null })
