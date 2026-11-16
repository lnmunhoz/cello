// CEL-76 scope (removed in the real build): the `?receipts=` and `?activity=` switches. The router keeps
// only the search params it knows, so a switch seen in the address is kept for the tab (sessionStorage)
// and still applies after opening and closing tasks. `?receipts=off` turns it off again.
import { type ActivityStyle, activityStyle, type ReceiptStyle, receiptStyle } from "./receipts.ts"

const remembered = <A>(name: string, parse: (search: string) => A | null): A | null => {
  // Rendered outside a browser (the unit tests render cards to markup): off.
  if (typeof location === "undefined") return null
  const key = `cello:scope-cel76:${name}`
  const fromUrl = parse(location.search)
  try {
    if (fromUrl !== null) sessionStorage.setItem(key, String(fromUrl))
    else if (new URLSearchParams(location.search).get(name) === "off") sessionStorage.removeItem(key)
    else return parse(`?${name}=${sessionStorage.getItem(key) ?? ""}`)
  } catch {}
  return fromUrl
}

export const currentReceiptStyle = (): ReceiptStyle | null => remembered("receipts", receiptStyle)
export const currentActivityStyle = (): ActivityStyle | null => remembered("activity", activityStyle)
