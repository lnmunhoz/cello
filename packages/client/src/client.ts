// The one client: shared by the web app, the CLI and the git hook.
import { CallerMiddleware, CelloRpcs } from "@cello/contract/rpcs"
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Headers from "effect/http/Headers"
import * as RpcClient from "effect/rpc/RpcClient"
import type { RpcClientError } from "effect/rpc/RpcClientError"
import type * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcMiddleware from "effect/rpc/RpcMiddleware"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import type * as Socket from "effect/socket/Socket"

export class CelloClient extends Context.Service<
  CelloClient,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof CelloRpcs>, RpcClientError>
>()("cello/CelloClient") {}

/** Identity travels as per-request RPC headers, so it works the same over any transport. */
const identityLayer = (identity: Readonly<Record<string, string>>) =>
  RpcMiddleware.layerClient(CallerMiddleware, ({ next, request }) =>
    next({ ...request, headers: Headers.setAll(request.headers, identity) }))

export const makeClientLayer = (socket: Layer.Layer<Socket.Socket>, identity: Readonly<Record<string, string>> = {}) =>
  Layer.effect(CelloClient, RpcClient.make(CelloRpcs)).pipe(
    Layer.provide(identityLayer(identity)),
    Layer.provide(RpcClient.layerProtocolSocket()),
    Layer.provide(socket),
    Layer.provide(RpcSerialization.layerJson),
  )

/** A fresh command id for every write. */
export const newCommandId = (): string => crypto.randomUUID()
