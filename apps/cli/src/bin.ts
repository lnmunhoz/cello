// `cello` from source: `bun apps/cli/src/bin.ts …`, serving the web app from apps/web/dist.
import { main } from "./main.ts"
import { webFromDirectory } from "./web.ts"

main(() => webFromDirectory(process.env))
