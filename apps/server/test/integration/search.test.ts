// `search.query` over a real socket (CEL-11, CEL-43): what the human and an agent write is found the
// moment the write returns, in the same shape the ⌘K bar and `cello search` read; and a board made
// before search is indexed when the server starts on it.
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { writeBoardBeforeAsks } from "../../src/testing/boardBeforeAsks.ts"
import { DB_FILE } from "../../src/server/ServerLock.ts"
import { AGENT_IDENTITY, connect, startServer, tempDataDir } from "./harness.ts"

describe("search.query", () => {
  it.live("finds what the human and an agent just wrote, grouped by kind, and jumps by key", () =>
    Effect.gen(function* () {
      const { port } = yield* startServer(yield* tempDataDir)
      const human = yield* connect(port)
      const agent = yield* connect(port, AGENT_IDENTITY)
      const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
      const { result: project } = yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL" })
      const { result: task } = yield* human["task.create"]({ commandId: newCommandId(), projectId: project.id, title: "Evidence videos in review" })
      yield* agent["comment.add"]({ commandId: newCommandId(), taskId: task.id, body: "Re-recorded the evidence in review mode." })

      const results = yield* human["search.query"]({ query: "evid", workspaceId })
      expect(results.groups.map((g) => [g.kind, g.hits.map((h) => h.taskKey)])).toEqual([["task", ["CEL-1"]], ["comment", ["CEL-1"]]])
      expect(results.groups[1]!.hits[0]).toMatchObject({ author: "Claude Code", textRanges: [[16, 24]] })

      const byKey = yield* agent["search.query"]({ query: "cel-1", project: { key: "CEL" } })
      expect(byKey.jump).toMatchObject({ id: task.id, title: "Evidence videos in review" })
      expect(byKey.groups.map((g) => g.kind)).toEqual(["comment"])

      expect(yield* Effect.flip(human["search.query"]({ query: "x", workspaceId, limit: 99 }))).toMatchObject({ _tag: "Invalid", field: "limit" })
    }).pipe(Effect.scoped))

  it.live("a board made before search is indexed when the server starts on it", () =>
    Effect.gen(function* () {
      const dataDir = yield* tempDataDir
      yield* writeBoardBeforeAsks(path.join(dataDir, DB_FILE))
      const { port } = yield* startServer(dataDir)
      const results = yield* (yield* connect(port))["search.query"]({ query: "task", project: { key: "CEL" } })
      expect(results.groups).toEqual([expect.objectContaining({ kind: "task", total: 3 })])
    }).pipe(Effect.scoped))
})
