// Small pieces of plain English shared by the CLI, the history lines and the web app.

/** "a", "a and b", "a, b and c". */
export const andList = (items: ReadonlyArray<string>): string =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`

/** "1 task", "3 tasks". */
export const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? "" : "s"}`

/** Edit distance between two strings (insertions, deletions, substitutions). */
const distance = (a: string, b: string): number => {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    previous = current
  }
  return previous[b.length]!
}

/** Up to three names close to `name`: a typo away (two for names of six letters or more), or containing it (or it them), closest first. */
export const closeMatches = (name: string, names: ReadonlyArray<string>): ReadonlyArray<string> => {
  const wanted = name.toLowerCase()
  const allowed = Math.max(1, Math.floor(wanted.length / 3))
  return names
    .map((candidate) => {
      const lower = candidate.toLowerCase()
      const contains = Math.min(lower.length, wanted.length) >= 3 && (lower.includes(wanted) || wanted.includes(lower))
      const score = contains ? Math.abs(lower.length - wanted.length) / 10 : distance(wanted, lower)
      return { candidate, score, close: contains || distance(wanted, lower) <= allowed }
    })
    .filter((m) => m.close)
    .sort((a, b) => a.score - b.score)
    .slice(0, 3)
    .map((m) => m.candidate)
}
