import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { cssEasing, duration, easing, exitMotion, layoutTransition, spring } from "./motion.ts"

const css = readFileSync(new URL("../index.css", import.meta.url), "utf8")

/** Every `--motion-*` declaration in a block of CSS, by name; the first one wins. */
const motionVars = (block: string) => {
  const vars = new Map<string, string>()
  for (const [, name, value] of block.matchAll(/--(motion-[a-z-]+):\s*([^;]+);/g)) {
    if (name && value && !vars.has(name)) vars.set(name, value.trim())
  }
  return vars
}
const root = motionVars(css)
const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)

describe("motion tokens", () => {
  it("gives every duration a CSS variable of the same value", () => {
    for (const [name, ms] of Object.entries(duration)) {
      expect(root.get(`motion-${name}`), name).toBe(`${ms}ms`)
    }
  })

  it("gives every easing a CSS variable of the same curve", () => {
    for (const name of Object.keys(easing) as Array<keyof typeof easing>) {
      expect(root.get(`motion-ease-${kebab(name)}`), name).toBe(cssEasing(name))
    }
  })

  it("sets the durations to zero when the human asks for reduced motion", () => {
    const block = /@media \(prefers-reduced-motion: reduce\) \{\s*:root \{([^}]*)\}/.exec(css)?.[1] ?? ""
    const reduced = motionVars(block)
    for (const name of Object.keys(duration)) {
      expect(reduced.get(`motion-${name}`), name).toBe("0ms")
    }
  })

  it("keeps the board's spring, and the layout transition is that spring", () => {
    expect(spring).toEqual({ type: "spring", stiffness: 520, damping: 42, mass: 0.7 })
    expect(layoutTransition).toBe(spring)
  })
})

describe("exitMotion", () => {
  it("slides out a panel that is on screen", () => {
    expect(exitMotion({ reduceMotion: false, shown: true })).toBe("slide")
  })

  it("leaves at once with reduced motion, or when the panel is covered and its slide could never end", () => {
    expect(exitMotion({ reduceMotion: true, shown: true })).toBe("leave")
    expect(exitMotion({ reduceMotion: false, shown: false })).toBe("leave")
  })
})

describe("the default transition", () => {
  it("is the fast token on the out easing, so a bare `transition-colors` follows the tokens and reduced motion", () => {
    const theme = /@theme inline \{([^}]*)\}/.exec(css)?.[1] ?? ""
    expect(theme).toMatch(/--default-transition-duration:\s*var\(--motion-fast\);/)
    expect(theme).toMatch(/--default-transition-timing-function:\s*var\(--motion-ease-out\);/)
  })
})
