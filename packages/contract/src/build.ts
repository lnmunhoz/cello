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
