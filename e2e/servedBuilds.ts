// Two real Cello builds served in turn (CEL-37, CEL-50): real web builds (`vite build`, each stamped with
// its own commit) served by a real `cello start` from source, on its own free port and data folder, so a
// test can stop the server and start the next build with the tab still open. Used by reload.spec.ts and
// builds.spec.ts.
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import * as fs from "node:fs"
import * as net from "node:net"
import * as path from "node:path"
import type { Page } from "@playwright/test"
import { defaultWorkspaceId } from "../packages/client/src/sync/follow.ts"
import { newCommandId, openClient } from "../packages/client/test/support/promiseClient.ts"

const root = path.resolve(import.meta.dirname, "..")
const RESERVED = new Set([4747, 4748, 5199, Number(process.env.CELLO_E2E_SERVER_PORT ?? 4791), Number(process.env.CELLO_WEB_PORT ?? 5199)])

export interface ServedBuild {
  readonly commit: string
  readonly dir: string
}

/** A screenshot for the review packet, without the recording's overlay. */
export const still = (page: Page, name: string) =>
  page.screenshot({
    path: path.join(import.meta.dirname, "videos", "evidence", `${name}.png`),
    animations: "disabled",
    style: "#e2e-caption, #e2e-cursor, .e2e-ripple { display: none !important; }",
  })

/** A real web build into `build.dir`, stamped with `build.commit`; `changes` replaces what its build.json lists (git isn't in the container). */
export const buildWeb = (build: ServedBuild, changes?: ReadonlyArray<string>) => {
  const result = spawnSync("bunx", ["vite", "build", "--outDir", build.dir, "--emptyOutDir", "--logLevel", "error"], {
    cwd: path.join(root, "apps/web"),
    encoding: "utf8",
    env: { ...process.env, CELLO_BUILD_COMMIT: build.commit },
  })
  if (result.status !== 0) throw new Error(`vite build failed: ${result.stderr}`)
  if (changes !== undefined) {
    const file = path.join(build.dir, "build.json")
    fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), changes }))
  }
}

/** The bundle a build's index.html loads ("/assets/index-Dk3….js"): which build a page runs. */
export const entryOf = (dir: string) =>
  /<script type="module" crossorigin src="([^"]+)"/.exec(fs.readFileSync(path.join(dir, "index.html"), "utf8"))![1]!
export const loadedEntry = (page: Page) => page.locator('script[type="module"]').first().getAttribute("src")

export const freePort = async (): Promise<number> => {
  for (;;) {
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer()
      server.once("error", reject)
      server.listen(0, "127.0.0.1", () => {
        const { port } = server.address() as net.AddressInfo
        server.close(() => resolve(port))
      })
    })
    if (!RESERVED.has(port)) return port
  }
}

const servers: ChildProcess[] = []

/** `cello start` from source serving `build` on `port`, with data in `dataDir`; resolves once it listens. */
export const startCello = (build: ServedBuild, port: number, dataDir: string) =>
  new Promise<ChildProcess>((resolve, reject) => {
    const child = spawn("bun", [path.join(root, "apps/cli/src/bin.ts"), "start"], {
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        CELLO_PORT: String(port),
        CELLO_DATA_DIR: dataDir,
        CELLO_WEB_DIR: build.dir,
        CELLO_BUILD_COMMIT: build.commit,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    servers.push(child)
    let output = ""
    child.stdout!.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk
      if (output.includes("Cello is running at")) resolve(child)
    })
    child.stderr!.setEncoding("utf8").on("data", (chunk: string) => (output += chunk))
    child.once("exit", (code) => reject(new Error(`cello start exited (${code}): ${output}`)))
  })

/**
 * Stops a server this test started, by its pid, and waits for it to exit. SIGKILL: with a tab
 * connected, a SIGTERM'd server still takes 20 s to exit (CEL-17), and the next one takes over its
 * stale lock either way.
 */
export const stop = (child: ChildProcess) =>
  new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve()
    child.once("exit", () => resolve())
    process.kill(child.pid!, "SIGKILL")
  })

/** Stops every server started so far; for afterEach. */
export const stopAll = async () => {
  for (const child of servers.splice(0)) await stop(child)
}

/** Project CEL with one task titled `title`, so the board and a task page have something on them. */
export const seed = async (port: number, title: string) => {
  const client = await openClient(`ws://127.0.0.1:${port}/rpc`)
  const snapshot = await client.run((c) => c["snapshot.get"]({}))
  const { result: project } = await client.run((c) =>
    c["project.create"]({ commandId: newCommandId(), workspaceId: defaultWorkspaceId(snapshot), name: "Cello", key: "CEL" }))
  await client.run((c) => c["task.create"]({ commandId: newCommandId(), projectId: project.id, title }))
  await client.close()
}
