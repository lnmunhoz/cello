// Uploading what Lucas pastes or drops into a box (CEL-47, CEL-73): images only, up to 20 MB, each
// posted at once; a refused one says why in a toast. `uploading` counts the ones still on their way, so
// the box's send button can wait for them.
import type { Attachment } from "@cello/contract/entities"
import { useState } from "react"
import { toast } from "../components/ui/Toast.tsx"
import { screenshotsFrom, uploadScreenshot } from "./screenshots.ts"

export const useScreenshotUpload = (url: string) => {
  const [uploading, setUploading] = useState(0)
  /** Uploads `files`, calling `onUploaded` with each stored draft as it arrives. */
  const attach = async (files: ReadonlyArray<File>, onUploaded: (attachment: Attachment) => void) => {
    const { accepted, refused } = screenshotsFrom(files)
    for (const reason of refused) toast.error(`${reason}.`)
    setUploading((n) => n + accepted.length)
    await Promise.all(accepted.map(async ({ index, name }) => {
      try {
        onUploaded(await uploadScreenshot(url, files[index]!, name))
      } catch (error) {
        toast.error((error as Error).message)
      } finally {
        setUploading((n) => n - 1)
      }
    }))
  }
  return { uploading, attach }
}
