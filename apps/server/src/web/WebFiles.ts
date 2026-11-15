// The built web app, served by the server on its own port. Files are a map from URL path to a file:
// a folder on disk (`apps/web/dist`), or the files embedded in the compiled `cello` binary. A path
// without an extension that isn't a file is a client route (/CEL/issues) and gets index.html, as does
// any page navigation to a path that isn't a file.
import * as fs from "node:fs"
import * as path from "node:path"
import * as Effect from "effect/Effect"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"

/** URL path ("/assets/app-abc.js") → file to send. Only these paths are served. */
export type WebFiles = ReadonlyMap<string, string>

/** Every file under `dir`, keyed by its URL path. */
export const fromDirectory = (dir: string): WebFiles => {
  const files = new Map<string, string>()
  const walk = (folder: string) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) files.set("/" + path.relative(dir, full).split(path.sep).join("/"), full)
    }
  }
  walk(dir)
  return files
}

/** Vite's hashed bundles never change; everything else (index.html above all) is revalidated. */
const cacheControl = (urlPath: string) => urlPath.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache"

const send = (urlPath: string, file: string) => {
  const blob = Bun.file(file)
  return HttpServerResponse.raw(blob, {
    headers: { "content-type": blob.type, "cache-control": cacheControl(urlPath) },
  })
}

const pathnameOf = (url: string): string | null => {
  try {
    return decodeURIComponent(new URL(url, "http://cello.local").pathname)
  } catch {
    return null
  }
}

export const handler = (files: WebFiles) =>
  Effect.map(Effect.service(HttpServerRequest.HttpServerRequest), (request) => {
    const pathname = pathnameOf(request.url)
    const file = pathname === null ? undefined : files.get(pathname === "/" ? "/index.html" : pathname)
    if (pathname !== null && file !== undefined) return send(pathname, file)
    const index = files.get("/index.html")
    // A page navigation to a path that isn't a file (a link to a missing `report/demo.mp4`) gets the app
    // too, whose Not found screen has a way back; a missing script or image stays a 404.
    const navigation = request.headers["sec-fetch-mode"] === "navigate"
    if (pathname !== null && (path.posix.extname(pathname) === "" || navigation) && index !== undefined) return send("/index.html", index)
    return HttpServerResponse.text("Not found", { status: 404 })
  })

/** Serves `files` for every GET the other routes (/rpc) don't take. */
export const layer = (files: WebFiles) => HttpRouter.add("GET", "/*", handler(files))
