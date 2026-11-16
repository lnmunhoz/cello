const PROJECT_KEY = /^[A-Z][A-Z0-9]{1,9}$/
const TASK_KEY = /^([A-Z][A-Z0-9]{1,9})-([1-9][0-9]*)$/

export const isValidProjectKey = (key: string): boolean => PROJECT_KEY.test(key)

/**
 * Words the board uses at the top of its address space, which a project key would collide with: a
 * project's pages are `/<KEY>/…`, and the router matches without case, so a project keyed BUILDS would be
 * hidden behind the Builds page. The board's top-level routes (apps/web/src/app/router.tsx) and the
 * server's own paths. Add a word here with every new top-level route.
 */
const RESERVED_KEYS: Readonly<Record<string, string>> = {
  BUILDS: "Builds page",
  SETTINGS: "Settings page",
  REVIEW: "Review page",
  AGENTS: "Agents page",
  ASSETS: "app files",
  ICONS: "app icons",
  ATTACHMENTS: "evidence files",
  RPC: "server connection",
}

/** Why `key` can't be a project key ("can't be BUILDS, the address of…"), when a page of Cello's has that address; null when it can. */
export const reservedKeyProblem = (key: string): string | null => {
  const upper = key.toUpperCase()
  const what = RESERVED_KEYS[upper]
  return what === undefined ? null : `can't be ${upper}, the address of Cello's ${what} (/${upper.toLowerCase()})`
}

/** First letters of each word for multi-word names, else the first four letters (min 3). */
export const suggestProjectKey = (name: string): string => {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
  let key = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "").slice(0, name.length > 5 ? 4 : 3)
  key = key.replace(/^[0-9]+/, "")
  if (key.length < 2) key = (key + "PRJ").slice(0, 3)
  return key.slice(0, 10)
}

/**
 * The key a new project named `name` gets when none is given: the suggestion if no project has it,
 * else a longer start of the name (CEL → CELL → CELLO), else the suggestion with a number (CEL2, CEL3…).
 */
export const freeProjectKey = (name: string, taken: (key: string) => boolean): string => {
  const base = suggestProjectKey(name)
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^[0-9]+/, "")
  const longer = [...Array(11).keys()].filter((n) => n > base.length).map((n) => letters.slice(0, n))
  const usable = (key: string) => !taken(key) && reservedKeyProblem(key) === null
  const free = [base, ...longer].find((key) => isValidProjectKey(key) && usable(key))
  if (free) return free
  for (let n = 2; ; n++) {
    const key = `${base.slice(0, 10 - String(n).length)}${n}`
    if (usable(key)) return key
  }
}

export const formatTaskKey = (projectKey: string, number: number): string => `${projectKey}-${number}`

export const parseTaskKey = (key: string): { projectKey: string; number: number } | null => {
  const match = TASK_KEY.exec(key.trim().toUpperCase())
  if (!match) return null
  return { projectKey: match[1]!, number: Number(match[2]) }
}

/**
 * The task keys a piece of text mentions ("building CEL-55, after CEL-35"), each once, in the order
 * they first appear. Only upper-case keys on word edges count, so "cel-55" or "XCEL-055x" don't.
 */
export const taskKeysIn = (text: string): string[] => {
  const keys = [...text.matchAll(/(?<![A-Za-z0-9_-])([A-Z][A-Z0-9]{1,9})-([1-9][0-9]*)(?![A-Za-z0-9_])/g)].map((m) => `${m[1]}-${m[2]}`)
  return [...new Set(keys)]
}

/** Where the board shows a task: `/CEL/3`. */
export const taskPath = (projectKey: string, number: number): string => `/${projectKey}/${number}`

/** The task a board path shows (`/CEL/3`, `/cel/3`), or null for any other path. */
export const parseTaskPath = (pathname: string): { projectKey: string; number: number } | null => {
  const match = /^\/([^/]+)\/([^/]+)$/.exec(pathname)
  return match ? parseTaskKey(`${match[1]}-${match[2]}`) : null
}
