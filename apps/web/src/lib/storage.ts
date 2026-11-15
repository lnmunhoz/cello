// This device's saved settings (theme, sidebar, panel widths) in localStorage. Storage can be missing
// or throw (a private window, blocked site data): reads give null and writes do nothing, never an error.

export const readStored = (key: string): string | null => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

export const writeStored = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value)
  } catch {}
}
