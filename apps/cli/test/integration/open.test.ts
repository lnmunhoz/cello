// `cello open` (CEL-88): a page's slug, its address or a task key becomes the cello:// link that opens it
// in Cello's desktop app. The command hands that link to the system (a fake here: tests never open
// anything) and prints it, for the agent to put in its reply instead of the http address.
import { newCommandId } from "@cello/client/client"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo } from "./cli.ts"

const SESSION = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const claude = { CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_PID: String(process.pid) }

const link = (url: string) => `cello://open?url=${encodeURIComponent(url)}`

const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port)
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })
  const opened: string[] = []
  const open = (link: string) => {
    opened.push(link)
    return Promise.resolve()
  }
  const piped = (stdin: string) => cello({ port, env: claude, cwd: repo, stdin })
  yield* piped("# Billing audit\n\nTwo duplicates.")("doc", "publish", "-", "--slug", "billing-audit")
  return { port, repo, opened, agent: cello({ port, env: claude, cwd: repo, open }) }
})

describe("cello open", () => {
  it.live("a slug opens the project's page in Cello, and the command prints the cello:// link to put in replies", () =>
    Effect.gen(function* () {
      const { agent, port, opened } = yield* setup
      const page = `http://127.0.0.1:${port}/CEL/pages/billing-audit`

      expect(yield* agent("open", "billing-audit")).toEqual({
        out: `Opened ${page} in Cello.\nLink in replies (opens in Cello): ${link(page)}`,
        failure: null,
      })
      expect(opened).toEqual([link(page)])
    }).pipe(Effect.scoped))

  it.live("--print prints only the link and opens nothing; --json gives the link and the page's address", () =>
    Effect.gen(function* () {
      const { agent, port, opened } = yield* setup
      const page = `http://127.0.0.1:${port}/CEL/pages/billing-audit`

      expect(yield* agent("open", "--print", "billing-audit")).toEqual({ out: link(page), failure: null })
      expect(JSON.parse((yield* agent("open", "billing-audit", "--print", "--json")).out)).toEqual({ link: link(page), url: page, opened: false })
      expect(JSON.parse((yield* agent("open", "billing-audit", "--json")).out)).toEqual({ link: link(page), url: page, opened: true })
      expect(opened).toEqual([link(page)])
    }).pipe(Effect.scoped))

  it.live("an address or a task key needs no server; a cello:// link comes back as it is", () =>
    Effect.gen(function* () {
      const opened: string[] = []
      const offline = cello({ port: 1, cwd: process.cwd(), open: (l) => Promise.resolve(void opened.push(l)) })
      const page = "http://127.0.0.1:4747/FE/pages/saved-library-design"

      expect(yield* offline("open", "--print", page)).toEqual({ out: link(page), failure: null })
      expect(yield* offline("open", "--print", link(page))).toEqual({ out: link(page), failure: null })
      expect(yield* offline("open", "CEL-12")).toEqual({ out: "Opened CEL-12 in Cello.\nLink in replies (opens in Cello): cello://CEL-12", failure: null })
      expect(opened).toEqual(["cello://CEL-12"])
    }))

  it.live("errors say what to do: an unknown page, something that isn't a page or a task, no app to open it", () =>
    Effect.gen(function* () {
      const { agent, port, repo } = yield* setup
      const page = `http://127.0.0.1:${port}/CEL/pages/billing-audit`

      expect((yield* agent("open", "biling-audit")).failure).toBe("No document CEL/biling-audit. Run `cello doc list` to see the project's documents.")
      expect((yield* agent("open", "Billing Audit")).failure).toBe(
        "Can't open \"Billing Audit\": give a page's address, its slug (billing-audit) or a task key (CEL-12).",
      )
      const noApp = cello({ port, env: claude, cwd: repo, open: () => Promise.reject(new Error("No application knows how to open URL cello://…")) })
      expect(yield* noApp("open", "billing-audit")).toEqual({
        out: "",
        failure: [
          `Couldn't open it in Cello: No application knows how to open URL cello://…`,
          "Is Cello's desktop app installed? The link, for your reply, is still:",
          link(page),
        ].join("\n"),
      })
    }).pipe(Effect.scoped))
})
