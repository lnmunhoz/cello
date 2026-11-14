// The app's one connection to the server and its atoms.
import { makeCelloAtoms } from "@cello/client/atoms"
import { makeClientLayer } from "@cello/client/client"
import * as Layer from "effect/Layer"
import * as Atom from "effect/reactivity/Atom"
import * as Socket from "effect/socket/Socket"
import { toast } from "../components/ui/Toast.tsx"

const protocol = location.protocol === "https:" ? "wss" : "ws"
const socket = Socket.layerWebSocket(`${protocol}://${location.host}/rpc`).pipe(Layer.provide(Socket.layerWebSocketConstructorGlobal))

export const runtime = Atom.runtime(makeClientLayer(socket))

export const cello = makeCelloAtoms(runtime, {
  onError: (message) => toast.error(message),
})

export const { boardAtom, syncedAtom, workspaceIdAtom, commands, commentsFamily, reviewsFamily, historyFamily } = cello
