// Which review packets Lucas has opened on this device (CEL-190), kept pure: a packet he hasn't opened
// since it was handed in (a new one after Send back included) gets a dot on its Review row.

/** The packet last opened for each task, by task key and review id. */
export type Seen = Readonly<Record<string, string>>

/** Where it is saved on this device (lib/storage.ts). */
export const SEEN_KEY = "cello:review:seen"

/** How many tasks it remembers: the newest. */
const KEEP = 200

/** The saved map; nothing saved, or anything that isn't a map of words, is nothing seen. */
export const parseSeen = (stored: string | null): Seen => {
  if (stored === null) return {}
  try {
    const value: unknown = JSON.parse(stored)
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
  } catch {
    return {}
  }
}

/** Whether `review` hasn't been opened since it was handed in. A task with no packet (moved by hand) has none to be unread. */
export const isUnread = (review: { readonly id: string } | null, seen: Seen, taskKey: string): boolean => review !== null && seen[taskKey] !== review.id

/** The map after `reviewId` of `taskKey` is opened: the same one when it already says so, else with it last, the oldest dropped past KEEP. */
export const markSeen = (seen: Seen, taskKey: string, reviewId: string): Seen => {
  if (seen[taskKey] === reviewId) return seen
  const { [taskKey]: _, ...rest } = seen
  return Object.fromEntries(Object.entries({ ...rest, [taskKey]: reviewId }).slice(-KEEP))
}
