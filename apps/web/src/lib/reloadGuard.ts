// What a tab remembers across a reload (CEL-37): the build it last reloaded for by itself, so it never
// reloads for the same one twice. Kept in sessionStorage (per tab); where that's blocked or throws,
// in `window.name`, which also lives as long as the tab and survives a reload.

const KEY = "cello:reloaded-for"
const NAME_PREFIX = `${KEY}=`

/** The two places a tab can keep it; the browser's own by default. */
export interface TabMemory {
  readonly session: () => Pick<Storage, "getItem" | "setItem">
  readonly name: { get: () => string; set: (value: string) => void }
}

const browser: TabMemory = {
  session: () => sessionStorage,
  name: { get: () => window.name, set: (value) => void (window.name = value) },
}

/** The build key this tab last reloaded for, or null. */
export const reloadedFor = (memory: TabMemory = browser): string | null => {
  try {
    const saved = memory.session().getItem(KEY)
    if (saved !== null) return saved
  } catch {}
  const name = memory.name.get()
  return name.startsWith(NAME_PREFIX) ? name.slice(NAME_PREFIX.length) : null
}

/** Remembers `key` as the build this tab reloaded for. */
export const rememberReload = (key: string, memory: TabMemory = browser): void => {
  try {
    memory.session().setItem(KEY, key)
    return
  } catch {}
  // Only take window.name when it's empty or already ours: a named window keeps its name.
  const name = memory.name.get()
  if (name === "" || name.startsWith(NAME_PREFIX)) memory.name.set(`${NAME_PREFIX}${key}`)
}
