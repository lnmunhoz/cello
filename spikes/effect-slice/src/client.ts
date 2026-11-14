// Spike (d): the one client, shared by the CLI and the browser.
import * as Context from "effect/Context"
import * as Layer from "effect/Layer"
import * as Headers from "effect/http/Headers"
import * as RpcClient from "effect/rpc/RpcClient"
import type { RpcClientError } from "effect/rpc/RpcClientError"
import type * as RpcGroup from "effect/rpc/RpcGroup"
import * as RpcMiddleware from "effect/rpc/RpcMiddleware"
import * as RpcSerialization from "effect/rpc/RpcSerialization"
import type * as Socket from "effect/socket/Socket"
import { CallerMiddleware, CelloRpcs } from "./contract.ts"

export class CelloClient extends Context.Service<
  CelloClient,
  RpcClient.RpcClient<RpcGroup.Rpcs<typeof CelloRpcs>, RpcClientError>
>()("cello/CelloClient") {}

/** Identity travels as per-request RPC headers, so it works over any transport. */
const identityLayer = (identity: Record<string, string>) =>
  RpcMiddleware.layerClient(CallerMiddleware, ({ next, request }) =>
    next({ ...request, headers: Headers.setAll(request.headers, identity) }))

export const makeClientLayer = (
  socket: Layer.Layer<Socket.Socket>,
  identity: Record<string, string>,
) =>
  Layer.effect(CelloClient, RpcClient.make(CelloRpcs)).pipe(
    Layer.provide(identityLayer(identity)),
    Layer.provide(RpcClient.layerProtocolSocket()),
    Layer.provide(socket),
    Layer.provide(RpcSerialization.layerJson),
  )
