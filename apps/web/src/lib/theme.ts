// Light and dark: follows the system until you pick one; index.html applies it before first paint.
const KEY = "cello:theme"

export const isDark = () => document.documentElement.classList.contains("dark")

export const toggleTheme = () => {
  const dark = !isDark()
  document.documentElement.classList.toggle("dark", dark)
  try {
    localStorage.setItem(KEY, dark ? "dark" : "light")
  } catch {}
  return dark
}
