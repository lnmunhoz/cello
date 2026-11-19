import { readStored, useStored, writeStored } from "../lib/storage.ts"
import { markSeen, parseSeen, type Seen, SEEN_KEY } from "./seen.ts"

/**
 * The packets Lucas has opened on this device (CEL-190), kept in localStorage (lib/storage.ts): `seen`
 * for the rows' dots, `markOpened` for when a packet opens. Read again at the write, so two writes in a
 * row don't lose one.
 */
export function useSeen(): { readonly seen: Seen; readonly markOpened: (taskKey: string, reviewId: string) => void } {
  const seen = parseSeen(useStored(SEEN_KEY))
  return {
    seen,
    markOpened: (taskKey, reviewId) => {
      const now = parseSeen(readStored(SEEN_KEY))
      const next = markSeen(now, taskKey, reviewId)
      if (next !== now) writeStored(SEEN_KEY, JSON.stringify(next))
    },
  }
}
