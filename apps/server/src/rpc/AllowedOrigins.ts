// Only local pages may talk to the server: the Host (and Origin, when a browser sends one) must be
// 127.0.0.1 or localhost on the server's own port or the Vite dev port. Blocks DNS rebinding and
// other websites opening a socket to the board.
import * as Effect from "effect/Effect"
import * as HttpRouter from "effect/http/HttpRouter"
import * as HttpServer from "effect/http/HttpServer"
import * as HttpServerRequest from "effect/http/HttpServerRequest"
import * as HttpServerResponse from "effect/http/HttpServerResponse"

/** The Vite dev/preview port; worktrees and parallel e2e runs set CELLO_WEB_PORT to avoid clashes. */
export const DEV_WEB_PORT = Number(process.env.CELLO_WEB_PORT ?? 5199)

const LOCAL_HOSTS = ["127.0.0.1", "localhost"]

export const isAllowedRequest = (
  headers: { readonly host?: string | undefined; readonly origin?: string | undefined },
  serverPort: number,
): boolean => {
  const allowed = new Set(
    LOCAL_HOSTS.flatMap((host) => [serverPort, DEV_WEB_PORT].map((port) => `${host}:${port}`)),
  )
  if (headers.host === undefined || !allowed.has(headers.host.toLowerCase())) return false
  if (headers.origin === undefined) return true
  try {
    const origin = new URL(headers.origin)
    return origin.protocol === "http:" && allowed.has(origin.host.toLowerCase())
  } catch {
    return false
  }
}

/** Global HTTP middleware: refuses (403) any request that fails `isAllowedRequest`. */
export const layer = HttpRouter.middleware(
  Effect.gen(function* () {
    const server = yield* HttpServer.HttpServer
    const port = "port" in server.address ? server.address.port : 0
    return (httpEffect) =>
      Effect.flatMap(Effect.service(HttpServerRequest.HttpServerRequest), (request) =>
        isAllowedRequest({ host: request.headers["host"], origin: request.headers["origin"] }, port)
          ? httpEffect
          : Effect.succeed(HttpServerResponse.text("Forbidden: Cello only accepts local pages.", { status: 403 })))
  }),
  { global: true },
)
