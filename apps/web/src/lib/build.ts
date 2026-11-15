// The build this tab was loaded with (CEL-37), and what it remembers across a reload.
import { buildKey, type BuildStamp } from "@cello/shared/build"
import * as Option from "effect/Option"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { useAtomValue } from "@effect/atom-react"
import type { ServerBuild } from "@cello/contract/build"
import { serverBuildAtom } from "./cello.ts"

/** Stamped into the bundle by apps/web/buildStamp.ts; null where it isn't (unit tests). */
export const loadedBuild: BuildStamp | null = typeof __CELLO_BUILD__ === "undefined" ? null : __CELLO_BUILD__

/** Per tab, so a reload remembers it and a new tab starts fresh. */
const RELOADED_KEY = "cello:reloaded-for"

/** The build this tab last reloaded for (`buildKey`), so it never reloads for the same one twice. */
export const reloadedFor = (): string | null => {
  try {
    return sessionStorage.getItem(RELOADED_KEY)
  } catch {
    return null
  }
}

/** Reloads the page to bring in `served`, remembering that it did. */
export const reloadInto = (served: BuildStamp): void => {
  try {
    sessionStorage.setItem(RELOADED_KEY, buildKey(served))
  } catch {}
  location.reload()
}

/** The server's build, the last one heard (kept while reconnecting); null until the first answer. */
export const useServerBuild = (): ServerBuild | null => Option.getOrNull(AsyncResult.value(useAtomValue(serverBuildAtom)))
