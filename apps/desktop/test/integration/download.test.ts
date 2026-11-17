// Downloading a DMG (CEL-140) from a real local HTTP server into a temp folder: it lands complete or not at
// all, and a failure never touches a file of the user's own with the same name.
import * as fs from "node:fs"
import * as http from "node:http"
import type * as net from "node:net"
import * as os from "node:os"
import * as path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { downloadFile } from "../../src/update/download.ts"

const cleanups: Array<() => unknown> = []
afterEach(async () => {
  for (const run of cleanups.splice(0).reverse()) await run()
})

/** Serves `body` at /dmg, with a Content-Length or chunked (none). */
const serve = async (body: string, withLength: boolean): Promise<string> => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, withLength ? { "content-length": String(Buffer.byteLength(body)) } : {})
    response.end(body)
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
  return `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/dmg`
}

const downloads = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cello-download-"))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

describe("downloadFile", () => {
  it("writes the file once it's complete, without a Content-Length too, when its size is what GitHub said", async () => {
    const dir = downloads()
    const file = path.join(dir, "Cello-v0.5.1-mac-arm64.dmg")
    await downloadFile(await serve("twelve bytes", false), file, 12, () => {})
    expect(fs.readFileSync(file, "utf8")).toBe("twelve bytes")
    expect(fs.readdirSync(dir)).toEqual(["Cello-v0.5.1-mac-arm64.dmg"])
  })

  it("without a Content-Length, a size other than GitHub's fails, and the user's same-named file stays as it was", async () => {
    const dir = downloads()
    const file = path.join(dir, "Cello-v0.5.1-mac-arm64.dmg")
    fs.writeFileSync(file, "my own file")
    await expect(downloadFile(await serve("cut short", false), file, 5000, () => {})).rejects.toThrow("the download stopped at 9 of 5000 bytes")
    expect(fs.readFileSync(file, "utf8")).toBe("my own file")
    expect(fs.readdirSync(dir)).toEqual(["Cello-v0.5.1-mac-arm64.dmg"])
  })

  it("with neither a Content-Length nor a size from GitHub, takes what came", async () => {
    const dir = downloads()
    const file = path.join(dir, "x.dmg")
    await downloadFile(await serve("whatever", false), file, 0, () => {})
    expect(fs.readFileSync(file, "utf8")).toBe("whatever")
  })

  it("a server error leaves nothing behind", async () => {
    const dir = downloads()
    const server = http.createServer((_request, response) => {
      response.writeHead(404)
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())))
    const url = `http://127.0.0.1:${(server.address() as net.AddressInfo).port}/dmg`
    await expect(downloadFile(url, path.join(dir, "x.dmg"), 5, () => {})).rejects.toThrow("the server answered 404")
    expect(fs.readdirSync(dir)).toEqual([])
  })
})
