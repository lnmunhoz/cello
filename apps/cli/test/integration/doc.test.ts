// `cello doc` against a real server with real files: publishing uploads the page's images and prints
// its URL; republishing keeps the URL and adds a version; agents read pages back with `doc get`.
import * as fs from "node:fs"
import * as path from "node:path"
import { newCommandId } from "@cello/client/client"
import { writePng, writeText } from "@cello/server/testing/media"
import { startServer, tempDataDir } from "@cello/server/testing/servers"
import { describe, expect, it } from "@effect/vitest"
import * as Effect from "effect/Effect"
import { connect } from "../../../server/test/integration/harness.ts"
import { cello, gitRepo } from "./cli.ts"

const SESSION = "2fd0505c-417a-4167-acfe-2d66080fcae0"
const claude = { CLAUDE_CODE_SESSION_ID: SESSION, CLAUDE_PID: String(process.pid) }

const setup = Effect.gen(function* () {
  const dataDir = yield* tempDataDir
  const { port } = yield* startServer(dataDir)
  const repo = gitRepo(dataDir, "cello")
  const human = yield* connect(port)
  const workspaceId = (yield* human["snapshot.get"]({})).workspaces[0]!.id
  yield* human["project.create"]({ commandId: newCommandId(), workspaceId, name: "Cello", key: "CEL", repoPath: repo })
  return {
    port,
    repo,
    agent: cello({ port, env: claude, cwd: repo }),
    piped: (stdin: string) => cello({ port, env: claude, cwd: repo, stdin }),
  }
})

const fetchBytes = (port: number, pathname: string) =>
  Effect.promise(async () => {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`)
    return { status: response.status, type: response.headers.get("content-type"), body: Buffer.from(await response.arrayBuffer()) }
  })

describe("cello doc", () => {
  it.live("publish uploads the page's images and prints its URL; republishing keeps the URL and adds a version; get prints the markdown", () =>
    Effect.gen(function* () {
      const { agent, port, repo } = yield* setup
      yield* agent("task", "create", "Audit billing")
      const reports = path.join(repo, "reports")
      fs.mkdirSync(path.join(reports, "shots"), { recursive: true })
      const png = writePng(path.join(reports, "shots"), "board.png")
      writeText(reports, "data.csv", "invoice,amount\n1,10\n")
      const report = (findings: string) =>
        writeText(reports, "billing.md", [
          "# Billing audit",
          "",
          "We checked every invoice since March.",
          "",
          "## Findings",
          "",
          findings,
          "",
          "![The board](shots/board.png)",
          "",
          "The raw numbers: [data.csv](data.csv).",
        ].join("\n"))
      report("Two duplicates.")

      const url = `http://127.0.0.1:${port}/CEL/pages/billing-audit`
      // The image the markdown links goes up by itself; --asset adds the CSV it links as text.
      expect(yield* agent("doc", "publish", "reports/billing.md", "--task", "CEL-1", "--asset", "reports/data.csv")).toEqual({
        out: `Published page "Billing audit" (version 1), linked to CEL-1, with 2 files\n${url}`,
        failure: null,
      })

      const first = (yield* agent("doc", "get", "billing-audit")).out
      const [imageUrl, csvUrl] = [...first.matchAll(/\/attachments\/\w+/g)].map((m) => m[0])
      expect(first).toBe([
        "# Billing audit",
        "",
        "We checked every invoice since March.",
        "",
        "## Findings",
        "",
        "Two duplicates.",
        "",
        `![The board](${imageUrl})`,
        "",
        `The raw numbers: [data.csv](${csvUrl}).`,
      ].join("\n"))
      const image = yield* fetchBytes(port, imageUrl!)
      expect(image).toMatchObject({ status: 200, type: "image/png" })
      expect(image.body.equals(fs.readFileSync(png))).toBe(true)
      expect((yield* fetchBytes(port, csvUrl!)).type).toBe("text/csv; charset=utf-8")

      // The same file again: same page, same URL, a new version.
      report("Three duplicates.")
      expect(yield* agent("doc", "publish", "reports/billing.md")).toEqual({
        out: `Updated page "Billing audit" to version 2, linked to CEL-1, with 1 file\n${url}`,
        failure: null,
      })
      expect(yield* agent("doc", "publish", "reports/billing.md")).toEqual({
        out: `No changes: page "Billing audit" is still version 2\n${url}`,
        failure: null,
      })
      expect((yield* agent("doc", "get", "billing-audit")).out).toContain("Three duplicates.")
      expect((yield* agent("doc", "get", "billing-audit", "--version", "1")).out).toContain("Two duplicates.")
      // Unchanged images keep their URL from version to version.
      expect((yield* agent("doc", "get", "billing-audit")).out).toContain(imageUrl!)

      expect((yield* agent("doc", "list")).out).toBe("billing-audit  page  v2  Billing audit  CEL-1  just now")
      const listed = JSON.parse((yield* agent("doc", "list", "--json")).out)
      expect(listed.documents.map((d: { slug: string; version: number }) => [d.slug, d.version])).toEqual([["billing-audit", 2]])
      const published = JSON.parse((yield* agent("doc", "publish", "reports/billing.md", "--json")).out)
      expect(published).toMatchObject({ url, seq: null, result: { slug: "billing-audit", version: 2 } })

      // The task shows its page.
      expect((yield* agent("task", "get", "CEL-1")).out).toContain(`Pages (1)\n  Billing audit (page, version 2)  ${url}`)
    }).pipe(Effect.scoped))

  it.live("stdin needs --slug to update a page; kinds stay; archive; errors say what to do", () =>
    Effect.gen(function* () {
      const { agent, piped, repo, port } = yield* setup
      expect((yield* piped("# Pages plan\n\nSteps.")("doc", "publish", "-", "--kind", "spec", "--slug", "plan")).out).toBe(
        `Published spec "Pages plan" (version 1)\nhttp://127.0.0.1:${port}/CEL/pages/plan`,
      )
      expect((yield* piped("# Pages plan\n\nMore steps.")("doc", "publish", "-", "--slug", "plan")).out.split("\n")[0]).toBe(
        "Updated spec \"Pages plan\" to version 2",
      )
      expect((yield* agent("doc", "list", "--kind", "spec")).out).toMatch(/^plan {2}spec {2}v2 {2}Pages plan {2}just now$/)
      expect((yield* agent("doc", "list", "--kind", "doc")).out).toBe("No docs in CEL yet. Publish one with `cello doc publish report.md --kind doc`.")

      expect((yield* agent("doc", "publish", "missing.md")).failure).toBe(`Can't read ${path.join(repo, "missing.md")}.`)
      expect((yield* agent("doc", "publish", "-", "--kind", "memo")).failure).toBe("No kind \"memo\". Use page, doc or spec.")
      expect((yield* agent("doc", "get", "nope")).failure).toBe("No document CEL/nope. Run `cello doc list` to see the project's documents.")
      expect((yield* agent("doc", "get", "plan", "--version", "9")).failure).toBe("No version 9 of CEL/plan. Run `cello doc list` to see the project's documents.")
      expect((yield* piped("# Bad")("doc", "publish", "-", "--slug", "Bad Slug")).failure).toBe(
        "\"Bad Slug\" isn't a slug; use lowercase words joined by dashes, like billing-audit.",
      )

      expect((yield* agent("doc", "archive", "plan")).out).toBe("Archived spec \"Pages plan\"")
      expect((yield* agent("doc", "list")).out).toBe("No documents in CEL yet. Publish one with `cello doc publish report.md`.")
    }).pipe(Effect.scoped))
})
