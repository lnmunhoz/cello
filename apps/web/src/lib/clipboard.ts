import { toast } from "../components/ui/Toast.tsx"

/**
 * Puts `text` on the clipboard and confirms it with a toast (`done`), or says it didn't work. The
 * desktop app allows the board to write the clipboard (apps/desktop/src/main.ts, clipboard-sanitized-write),
 * so this is the same in the browser and the app.
 */
export const copyText = (text: string, done: string): void => {
  if (!navigator.clipboard) {
    toast.error("Couldn't copy: the clipboard isn't available here")
    return
  }
  navigator.clipboard.writeText(text).then(
    () => toast(done),
    () => toast.error("Couldn't copy to the clipboard"),
  )
}
