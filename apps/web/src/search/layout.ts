// The ⌘K bar's two layouts (CEL-43): Peek (the results and a preview of the highlighted one), the
// default, and Palette (centred, one line per result). Lucas picks one in the bar's footer or in
// Settings; this device remembers it. Peek shows as Palette in a window too narrow for its preview.
import { useStored } from "../lib/storage.ts"

/** Opens the bar from any page. */
export const COMMAND_BAR_SHORTCUT = "mod+k"

export type BarLayout = "peek" | "palette"

export const BAR_LAYOUT_KEY = "cello:search-layout"

/** The saved choice; Peek unless Palette was picked. */
export const readBarLayout = (stored: string | null): BarLayout => (stored === "palette" ? "palette" : "peek")

/** The layout picked in the bar's footer or Settings, re-rendering both when either changes it. */
export const useBarLayout = (): BarLayout => readBarLayout(useStored(BAR_LAYOUT_KEY))

/** Below this window width Peek has no room for its preview, so the bar shows as Palette. */
export const PEEK_MIN_WIDTH = 900

/** The layout on screen: the chosen one, unless Peek is chosen in a narrow window. */
export const shownLayout = (chosen: BarLayout, narrow: boolean): BarLayout => (chosen === "peek" && narrow ? "palette" : chosen)

export const LAYOUT_NAMES: Record<BarLayout, string> = { peek: "Peek", palette: "Palette" }
