// Light and dark: follows the system until you pick one; index.html applies it before first paint.
import { useStored, writeStored } from "./storage.ts"

const KEY = "cello:theme"

export const isDark = () => document.documentElement.classList.contains("dark")

export const toggleTheme = () => {
  const dark = !isDark()
  document.documentElement.classList.toggle("dark", dark)
  writeStored(KEY, dark ? "dark" : "light")
  return dark
}

/** Whether the dark theme is on, re-rendering wherever it shows when anything on the page switches it (the sidebar, ⌘K). */
export const useDark = (): boolean => {
  // Read from the saved choice, so the value changes with it (React Compiler keeps a call with no inputs).
  const saved = useStored(KEY)
  return saved === null ? isDark() : saved === "dark"
}
