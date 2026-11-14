const short = (d: Date, withYear: boolean) =>
  d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) })

/** "Mar 31", or "Mar 31, 2025" outside the current year. */
export const formatDay = (ms: number, now = Date.now()): string => {
  const d = new Date(ms)
  return short(d, d.getFullYear() !== new Date(now).getFullYear())
}

/** A `YYYY-MM-DD` due date as a local calendar day. */
export const formatDue = (day: string, now = Date.now()): string => {
  const [y, m, d] = day.split("-").map(Number)
  return formatDay(new Date(y!, m! - 1, d!).getTime(), now)
}

export const relativeTime = (ms: number, now = Date.now()): string => {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  if (s < 60) return "just now"
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)} d ago`
  return formatDay(ms, now)
}
