// The server's build (CEL-37): APP_VERSION, the commit it was built from, when this process started,
// and the stamp of the web app it serves (build.json, written by `vite build` beside index.html). Open
// tabs ask for it on every (re)connect, so a tab running an older web build can offer a reload.
import * as fs from "node:fs"
import { type ServerBuild, WebBuild } from "@cello/contract/build"
import { APP_VERSION } from "@cello/shared/version"
import * as Clock from "effect/Clock"
import * as Context from "effect/Context"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Schema from "effect/Schema"
import type { WebFiles } from "../web/WebFiles.ts"

export class BuildInfo extends Context.Service<BuildInfo, {
  readonly get: () => Effect.Effect<ServerBuild>
}>()("cello/BuildInfo") {}

/** Where `vite build` puts the web build's stamp, as a URL path of the built files. */
export const WEB_BUILD_FILE = "/build.json"

const decodeWebBuild = Schema.decodeUnknownOption(Schema.fromJsonString(WebBuild))

/** The stamp of the web app in `files`; null without one, or when build.json is missing or doesn't parse. */
export const readWebBuild = (files: WebFiles | undefined): WebBuild | null => {
  const file = files?.get(WEB_BUILD_FILE)
  if (file === undefined) return null
  try {
    const decoded = decodeWebBuild(fs.readFileSync(file, "utf8"))
    return decoded._tag === "Some" ? decoded.value : null
  } catch {
    return null
  }
}

/** build.json's modification time and size, or null when it can't be read (missing mid-rebuild). */
const versionOf = (file: string): string | null => {
  try {
    const stat = fs.statSync(file)
    return `${stat.mtimeMs}:${stat.size}`
  } catch {
    return null
  }
}

export interface BuildOptions {
  /** The commit the server was built from; null when unknown. */
  readonly commit: string | null
  /** The web app it serves; undefined when none. */
  readonly web: WebFiles | undefined
}

export const layer = (options: BuildOptions) =>
  Layer.effect(BuildInfo, Effect.gen(function* () {
    const startedAt = yield* Clock.currentTimeMillis
    const file = options.web?.get(WEB_BUILD_FILE)
    // Run from source, the web files are read from disk on every request, so `vite build` can replace
    // them under a running server: build.json is read again whenever its mtime or size changes.
    let cached: { readonly version: string | null; readonly web: WebBuild | null } | null = null
    const webBuild = (): WebBuild | null => {
      if (file === undefined) return null
      const version = versionOf(file)
      if (cached === null || cached.version !== version) cached = { version, web: version === null ? null : readWebBuild(options.web) }
      return cached.web
    }
    return BuildInfo.of({
      get: Effect.fn("BuildInfo.get")(function* () {
        return { version: APP_VERSION, commit: options.commit, startedAt, web: webBuild() } satisfies ServerBuild
      }),
    })
  }))
