// `cello` from source: `bun apps/cli/src/bin.ts …`, serving the web app from apps/web/dist, with the
// checkout's HEAD (or CELLO_BUILD_COMMIT) as its build.
import { buildCommit } from "@cello/server/build/git"
import { main } from "./main.ts"
import { webFromSource } from "./web.ts"

main(webFromSource, { commit: buildCommit(process.env, import.meta.dir) })
