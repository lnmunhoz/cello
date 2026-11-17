// Who may send the commands that change the app (Settings → Board's switch, the update settings; CEL-149): only
// the board's own page in the board view's top frame, on the origin the board was loaded from. A frame inside it
// (a page framed in the side panel) or another page that ends up in the view can't.

/** The sending frame: its address, and whether it's the view's top frame (`senderFrame.parent === null`). */
export interface SenderFrame {
  readonly url: string
  readonly top: boolean
}

export const isBoardPage = (frame: SenderFrame | null, boardOrigin: string | null): boolean => {
  if (frame === null || !frame.top || boardOrigin === null) return false
  return URL.parse(frame.url)?.origin === new URL(boardOrigin).origin
}
