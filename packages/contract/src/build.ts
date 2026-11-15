// Which build of Cello the server runs (CEL-37). Schemas only; the logic that compares builds is in
// packages/shared/src/build.ts.
import * as Schema from "effect/Schema"
import { Millis } from "./entities.ts"

/** A web build's stamp, as `vite build` writes it to build.json beside index.html (apps/web/buildStamp.ts). */
export const WebBuild = Schema.Struct({
  version: Schema.String,
  /** The git commit it was built from; null outside a git checkout. */
  commit: Schema.NullOr(Schema.String),
  builtAt: Millis,
  /** First-parent commit subjects since the previous build in the same folder, newest first; empty when unknown. */
  changes: Schema.Array(Schema.String),
})
export type WebBuild = typeof WebBuild.Type

/** The server's build: what `server.build` returns, `cello whoami` prints and the sidebar's footer shows. */
export const ServerBuild = Schema.Struct({
  /** APP_VERSION. */
  version: Schema.String,
  /** The git commit the server was built from (embedded by `bun run build`, else read from the checkout); null when unknown. */
  commit: Schema.NullOr(Schema.String),
  /** When this server process started. */
  startedAt: Millis,
  /** The web app it serves; null when it serves none (dev, where Vite serves the app). */
  web: Schema.NullOr(WebBuild),
})
export type ServerBuild = typeof ServerBuild.Type

/**
 * One build the server has run (CEL-50), recorded the first time a server starts serving it. A build is
 * its version, commit and web build time together (`buildKey` in packages/shared/src/build.ts).
 */
export const BuildRecord = Schema.Struct({
  /** `buildKey`: "0.2.0+c602f25.1763230740000". */
  id: Schema.String,
  /** 1 for the first build recorded in this data folder, then 2, 3… */
  number: Schema.Number,
  version: Schema.String,
  /** The commit it was built from; null when unknown. */
  commit: Schema.NullOr(Schema.String),
  /** When its web app was built. */
  webBuiltAt: Millis,
  /** When a server first started on it: when it went live. */
  startedAt: Millis,
  /** When a server last started on it (a restart of the same build moves only this). */
  lastStartedAt: Millis,
  /** When the next build went live; null for the newest. */
  liveUntil: Schema.NullOr(Millis),
  /** First-parent commit subjects since the previous recorded build, newest first. */
  changes: Schema.Array(Schema.String),
})
export type BuildRecord = typeof BuildRecord.Type

/** A page of `builds.list`, newest first. */
export const BuildPage = Schema.Struct({
  builds: Schema.Array(BuildRecord),
  /** The id of the build the server runs now; null when it isn't a recorded one (no web app served). */
  running: Schema.NullOr(Schema.String),
  /** Pass as `before` for the next, older page; null when this is the last. */
  next: Schema.NullOr(Schema.Number),
})
export type BuildPage = typeof BuildPage.Type
