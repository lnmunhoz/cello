// A file size for people: "512 B", "1.2 KB", "38 MB", "1.1 GB". Decimal units (1 KB = 1000 bytes),
// the way macOS Finder counts, so a size in Cello matches what Lucas sees for the same file in Finder.
const UNITS = ["KB", "MB", "GB", "TB"] as const

export const formatBytes = (bytes: number): string => {
  if (bytes < 1000) return `${bytes} B`
  let value = bytes / 1000
  let unit = 0
  // 999.5 would print as "1000"; it's the next unit's "1.0" instead.
  while (value >= 999.5 && unit < UNITS.length - 1) {
    value /= 1000
    unit++
  }
  return `${value < 9.95 ? value.toFixed(1) : Math.round(value)} ${UNITS[unit]}`
}
