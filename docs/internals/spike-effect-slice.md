# Spike (d): one Effect slice, end to end

Run on 2026-11-14 with Bun 1.4.4 and Effect 4.1.4 (`effect`, `@effect/platform-bun`, `@effect/sql-sqlite-bun`, `@effect/atom-react`). Code: `spikes/effect-slice/`.

## What was built

- **Contract** (`src/contract.ts`): Effect Schema types, three RPCs (`task.create`, `snapshot.get`, streaming `events.subscribe`), a tagged `EmptyTitle` error, and a `CallerMiddleware` that provides a `Caller` service.
- **Server** (`src/server.ts`): `TaskService` and `EventLog` services, thin handlers, SQLite with `tasks`, `events` (with `command_id` and `schema_version`) and `command_receipts`, RPC over a WebSocket at `/rpc` on Bun's HTTP server.
- **One client** (`src/client.ts`): `RpcClient` over a socket, used by both the CLI (Bun socket) and the browser (global WebSocket).
- **CLI** (`src/cli.ts`): `cello task create <title>` with `effect/cli`.
- **Browser** (`web/main.tsx`): one atom that takes a snapshot, follows the event stream, and folds events through a pure `applyEvents` reducer.

## Results

| Gate | Result |
| --- | --- |
| Works end to end | **Pass.** CLI → server → SQLite → event → browser. |
| Agent identity reaches the server | **Pass.** Per-request RPC headers (`x-cello-session`, `x-cello-client`, `x-cello-pid`) set by a client middleware; the server middleware turns them into `Caller`. `CELLO_SESSION=me` records the human. |
| Typed errors | **Pass.** `EmptyTitle` is in the RPC's type; the CLI must handle it. The compiler also rejected storage errors leaking into the API, which led to the "storage failures are defects" rule. |
| Retries are safe | **Pass.** The same `command_id` twice returns the same task and the same event `seq`. |
| Server commit → live subscriber | **0.7 ms** average, 2 ms max. |
| CLI → subscriber, running from source | 103 ms average (Bun start plus module loading). Over the gate. |
| Compiled binary (`bun build --compile`) | Starts in ~40 ms; a full `task create` takes ~50 ms. Binary is 89 MB. |
| **CLI → visible in the browser (compiled)** | **78–81 ms** warm, 182 ms on the first, cold run. **Pass** (gate: under 100 ms). |

Video: `spikes/effect-slice/videos/cli-create-appears-in-browser.mp4`.

## Lessons for M1

- **Identity goes in RPC headers, not WebSocket upgrade headers.** RPC headers work the same from Bun, the browser and a future MCP transport. This replaces the upgrade-header plan in "Settled in review".
- **Ship the CLI as the compiled binary.** Running from source costs ~100 ms per call; the binary is about half that.
- **Storage errors are defects** (`Effect.orDie` at the service edge). API errors are only the tagged domain errors in the contract.
- **The subscribe handoff works as specified:** join the live PubSub, replay from the table, skip by `seq`.
- **The contract file is kept** as M1's starting point, as the spec planned.
- Effect 4 API notes, found by reading `~/projects/t3code/.repos/effect` (Effect's own source and tests):
  - `RpcServer.layerProtocolWebsocket({ path })` with `HttpRouter.serve`
  - `RpcClient.layerProtocolSocket()` with `BunSocket.layerWebSocket`, or `Socket.layerWebSocket` in the browser
  - `RpcMiddleware.layerClient` to add headers
  - `Argument.String`, not `Argument.string`
  - `Stream.scan` takes its initial value as a function
