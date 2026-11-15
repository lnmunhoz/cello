// Light and dark: follows the system until you pick one; index.html applies it before first paint.
import { writeStored } from "./storage.ts"

const KEY = "cello:theme"

export const isDark = () => document.documentElement.classList.contains("dark")

export const toggleTheme = () => {
  const dark = !isDark()
  document.documentElement.classList.toggle("dark", dark)
  writeStored(KEY, dark ? "dark" : "light")
  return dark
}
