// A folder per subagent over a real server (CEL-152): the Agents page showed whichever agent of a session
// called `cello` last, because every call overwrote the session's folder. Now a subagent's call (it carries
// its `x-cello-agent`) sets its own folder and leaves the session's; the session's own call sets the session's.
import { newCommandId } from "@cello/client/client"
import { IDENTITY_HEADERS } from "@cello/contract/rpcs"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect, startServer, tempDataDir } from "./harness.ts"

const SESSION = {
  [IDENTITY_HEADERS.session]: "5c1e0b7a-agent-cwd",
  [IDENTITY_HEADERS.client]: "Claude Code",
  [IDENTITY_HEADERS.pid]: String(process.pid),
}
const from = (cwd: string, agent?: { readonly id: string; readonly type: string }) => ({
  ...SESSION,
  [IDENTITY_HEADERS.cwd]: cwd,
  ...(agent ? { [IDENTITY_HEADERS.agent]: agent.id, [IDENTITY_HEADERS.agentType]: agent.type } : {}),
})

describe("a folder per subagent over a real server", () => {
  it.live("two subagents of one session each keep their own folder; the session keeps its own", () =>
    Effect.gen(function* () {
      const { port } = yield* startServer(yield* tempDataDir)
      const human = yield* connect(port)
      const workspace = (yield* human["snapshot.get"]({})).workspaces[0]!
      const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId: workspace.id, name: "Cello", key: "CEL" })
      const { result: task } = yield* human["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Where am I" })

      // The orchestrating session, in the main checkout, claims the card.
      const session = yield* connect(port, from("/work/main"))
      yield* session["task.claim"]({ commandId: newCommandId(), key: task.key })
      // Two of its builders call cello from their own worktrees, one after the other, then the first again.
      const a = yield* connect(port, from("/work/wt-a", { id: "a1", type: "cello-builder" }))
      const b = yield* connect(port, from("/work/wt-b", { id: "b2", type: "cello-builder" }))
      yield* a["whoami"]({ project: {} })
      yield* b["whoami"]({ project: {} })
      yield* a["whoami"]({ project: {} })

      const read = Effect.gen(function* () {
        const snapshot = yield* human["snapshot.get"]({ scope: { workspaceId: workspace.id } })
        return {
          session: snapshot.sessions.map((s) => s.cwd),
          agents: Object.fromEntries(snapshot.agents.map((agent) => [agent.agentId, agent.cwd])),
        }
      })
      expect(yield* read).toEqual({ session: ["/work/main"], agents: { a1: "/work/wt-a", b2: "/work/wt-b" } })

      // The session's own call moves the session's folder and no agent's.
      const inSubfolder = yield* connect(port, from("/work/main/docs"))
      yield* inSubfolder["whoami"]({ project: {} })
      expect(yield* read).toEqual({ session: ["/work/main/docs"], agents: { a1: "/work/wt-a", b2: "/work/wt-b" } })

      // A subagent that moves reports its new folder; one that says none keeps what it had.
      const moved = yield* connect(port, from("/work/wt-b/apps", { id: "b2", type: "cello-builder" }))
      yield* moved["whoami"]({ project: {} })
      const { [IDENTITY_HEADERS.cwd]: _cwd, ...noFolder } = from("/ignored", { id: "a1", type: "cello-builder" })
      const quiet = yield* connect(port, noFolder)
      yield* quiet["whoami"]({ project: {} })
      expect(yield* read).toEqual({ session: ["/work/main/docs"], agents: { a1: "/work/wt-a", b2: "/work/wt-b/apps" } })
    }).pipe(Effect.scoped))

  it.live("a hook's agent.report of a start hands back the subagent with its folder", () =>
    Effect.gen(function* () {
      const { port } = yield* startServer(yield* tempDataDir)
      const hook = yield* connect(port, from("/work/wt-c", { id: "c3", type: "cello-builder" }))
      const agent = yield* hook["agent.report"]({ agentId: "c3", agentType: "cello-builder", state: "started" })
      expect(agent).toMatchObject({ agentId: "c3", cwd: "/work/wt-c" })
    }).pipe(Effect.scoped))
})
