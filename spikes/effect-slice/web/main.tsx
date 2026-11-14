// Spike (d): browser. One atom holds the task list: snapshot, then the live stream, through a pure reducer.
import { RegistryProvider, useAtomValue } from "@effect/atom-react"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import * as Stream from "effect/Stream"
import * as Atom from "effect/reactivity/Atom"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import * as Socket from "effect/socket/Socket"
import { createRoot } from "react-dom/client"
import { CelloClient, makeClientLayer } from "../src/client.ts"
import type { CelloEvent, Task } from "../src/contract.ts"

type State = { seq: number; tasks: ReadonlyArray<Task> }

/** Pure reducer: ignore anything at or below the state's seq; keep unchanged rows as the same objects. */
export const applyEvents = (state: State, events: ReadonlyArray<CelloEvent>): State => {
  let next = state
  for (const event of events) {
    if (event.seq <= next.seq) continue
    switch (event.type) {
      case "task.created":
        next = { seq: event.seq, tasks: [...next.tasks, event.task] }
    }
  }
  return next
}

const socket = Socket.layerWebSocket(`ws://${location.host}/rpc`).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal))
const runtime = Atom.runtime(makeClientLayer(socket, {}))

const boardAtom = runtime.atom(Stream.unwrap(Effect.gen(function* () {
  const client = yield* CelloClient
  const snapshot = yield* client["snapshot.get"]()
  return client["events.subscribe"]({ afterSeq: snapshot.seq }).pipe(
    Stream.scan((): State => snapshot, (state: State, event: CelloEvent) => applyEvents(state, [event])),
  )
})))

function Board() {
  const result = useAtomValue(boardAtom)
  return AsyncResult.match(result, {
    onInitial: () => <p>Connecting…</p>,
    onFailure: (f) => <pre>Failed: {String(f.cause)}</pre>,
    onSuccess: ({ value }) => (
      <div>
        <p data-testid="seq">seq {value.seq}</p>
        <ul>{value.tasks.map((t) => <li key={t.id} data-key={t.key}><b>{t.key}</b> {t.title} <i>by {t.actor}</i></li>)}</ul>
      </div>
    ),
  })
}

createRoot(document.getElementById("root")!).render(<RegistryProvider><Board /></RegistryProvider>)
