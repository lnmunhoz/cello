// Downloading a release's DMG (CEL-140): streamed to `<file>.part`, checked against the size the server
// sent (Content-Length) or else the one GitHub's release list gave, then renamed, so Downloads never holds
// a half-written DMG under the real name, and a failure never touches a file already there.
import * as fs from "node:fs"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { FetchFile } from "./Updater.ts"

export const downloadFile: FetchFile = async (url, file, size, onProgress) => {
  const response = await fetch(url, { headers: { "user-agent": "Cello.app" } })
  if (!response.ok || !response.body) throw new Error(`the server answered ${response.status}`)
  const total = Number(response.headers.get("content-length")) || size
  const part = `${file}.part`
  let received = 0
  const counted = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>)
  counted.on("data", (chunk: Buffer) => {
    received += chunk.length
    if (total > 0) onProgress(Math.min(1, received / total))
  })
  try {
    await pipeline(counted, fs.createWriteStream(part))
    if (total > 0 && received !== total) throw new Error(`the download stopped at ${received} of ${total} bytes`)
    fs.renameSync(part, file)
    onProgress(1)
  } catch (error) {
    fs.rmSync(part, { force: true })
    throw error
  }
}
