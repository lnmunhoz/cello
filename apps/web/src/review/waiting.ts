// How long each Review row has waited on Lucas (CEL-190), kept pure.

/** "waiting 5 min", "waiting 3 h", "waiting 2 d": how long ago `since` was, in the units `relativeTime` counts in. */
export const waitingLabel = (since: number, now = Date.now()): string => {
  const s = Math.max(0, Math.round((now - since) / 1000))
  if (s < 60) return "waiting <1 min"
  if (s < 3600) return `waiting ${Math.floor(s / 60)} min`
  if (s < 86_400) return `waiting ${Math.floor(s / 3600)} h`
  return `waiting ${Math.floor(s / 86_400)} d`
}

/**
 * The key of the row that has waited longest, so it can stand out. None when there is nothing to compare
 * (fewer than two rows) or when rows tie for the earliest time, where no one row is the oldest.
 */
export const oldestKey = (rows: ReadonlyArray<{ readonly key: string; readonly since: number }>): string | null => {
  if (rows.length < 2) return null
  const earliest = Math.min(...rows.map((r) => r.since))
  const oldest = rows.filter((r) => r.since === earliest)
  return oldest.length === 1 ? oldest[0]!.key : null
}
