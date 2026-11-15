const PROJECT_KEY = /^[A-Z][A-Z0-9]{1,9}$/
const TASK_KEY = /^([A-Z][A-Z0-9]{1,9})-([1-9][0-9]*)$/

export const isValidProjectKey = (key: string): boolean => PROJECT_KEY.test(key)

/** First letters of each word for multi-word names, else the first four letters (min 3). */
export const suggestProjectKey = (name: string): string => {
  const words = name.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").split(/\s+/).filter(Boolean)
  let key = words.length > 1 ? words.map((w) => w[0]).join("") : (words[0] ?? "").slice(0, name.length > 5 ? 4 : 3)
  key = key.replace(/^[0-9]+/, "")
  if (key.length < 2) key = (key + "PRJ").slice(0, 3)
  return key.slice(0, 10)
}

export const formatTaskKey = (projectKey: string, number: number): string => `${projectKey}-${number}`

export const parseTaskKey = (key: string): { projectKey: string; number: number } | null => {
  const match = TASK_KEY.exec(key.trim().toUpperCase())
  if (!match) return null
  return { projectKey: match[1]!, number: Number(match[2]) }
}

/** Where the board shows a task: `/CEL/3`. */
export const taskPath = (projectKey: string, number: number): string => `/${projectKey}/${number}`

/** The task a board path shows (`/CEL/3`, `/cel/3`), or null for any other path. */
export const parseTaskPath = (pathname: string): { projectKey: string; number: number } | null => {
  const match = /^\/([^/]+)\/([^/]+)$/.exec(pathname)
  return match ? parseTaskKey(`${match[1]}-${match[2]}`) : null
}
