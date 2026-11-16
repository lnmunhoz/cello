// What the e2e videos show besides the board: the agent's terminal, drawn over the page so the video
// shows its side next to Lucas's, and the clipboard Lucas pastes a screenshot from.
import * as fs from "node:fs"
import type { Page } from "@playwright/test"

/** The agent's terminal, drawn at the bottom left so the video shows its side next to the board. */
export const showTerminal = async (page: Page, command: string, output: string) => {
  await page.evaluate(([cmd, out]) => {
    let el = document.getElementById("e2e-terminal")
    if (!el) {
      el = document.createElement("pre")
      el.id = "e2e-terminal"
      el.setAttribute("aria-label", "Agent terminal")
      Object.assign(el.style, {
        position: "fixed", zIndex: "2147483646", left: "24px", bottom: "84px", width: "760px", maxHeight: "70vh", overflow: "hidden",
        margin: "0", padding: "14px 16px", borderRadius: "10px", background: "rgb(16 16 20 / .94)", color: "#e8e8ec",
        font: "12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace", whiteSpace: "pre-wrap", boxShadow: "0 12px 40px rgb(0 0 0 / .35)",
      })
      document.body.append(el)
    }
    el.textContent = `${el.textContent ? `${el.textContent}\n\n` : ""}agent session $ ${cmd}\n${out}`
    el.scrollTop = el.scrollHeight
  }, [command, output] as const)
}

export const hideTerminal = (page: Page) => page.evaluate(() => document.getElementById("e2e-terminal")?.remove())

/** Puts a PNG on the clipboard, the way a screenshot tool leaves one. The context needs clipboard permissions. */
export const copyImage = async (page: Page, file: string) => {
  const base64 = fs.readFileSync(file).toString("base64")
  await page.evaluate(async (data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0))
    await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([bytes], { type: "image/png" }) })])
  }, base64)
}

/** The width and height a PNG says it is: the clipboard re-encodes an image, so compare what it shows. */
export const pngSize = (file: string): [number, number] => {
  const bytes = fs.readFileSync(file)
  if (bytes.subarray(1, 4).toString() !== "PNG") throw new Error(`${file} isn't a PNG`)
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)]
}
