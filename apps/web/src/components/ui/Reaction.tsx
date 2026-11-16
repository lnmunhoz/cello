import { Button as BaseButton } from "@ui-sdk/react/button"
import type { ComponentProps, ReactNode } from "react"
import { variants, type VariantProps } from "./variants.ts"

type BaseProps = Omit<ComponentProps<typeof BaseButton>, "className" | "style" | "children">

/**
 * An emoji reaction under a comment (CEL-77): the emoji and how many reacted with it. Pressed when one
 * of them is you; a click toggles yours.
 */
export function ReactionChip({ emoji, count, mine, ...props }: BaseProps & { emoji: string; count: number; mine: boolean }) {
  return (
    <BaseButton
      type="button"
      aria-pressed={mine}
      {...props}
      className="inline-flex h-6 shrink-0 select-none items-center gap-1 rounded-full border border-line bg-raised px-2 text-xs font-medium text-muted tabular-nums outline-none transition-colors hover:border-line-strong hover:text-ink focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-accent/50 aria-pressed:bg-accent/12 aria-pressed:text-accent"
    >
      <span aria-hidden className="text-[13px] leading-none">{emoji}</span>
      <span>{count}</span>
    </BaseButton>
  )
}

const pick = variants(
  "inline-flex shrink-0 select-none items-center justify-center rounded-md leading-none outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent/12",
  {
    size: {
      /** The quick picks along the top of the picker. */
      quick: "size-9 text-xl",
      /** The fuller grid under them. */
      grid: "size-8 text-lg",
    },
  },
  { size: "grid" },
)

/** One emoji to react with, in the picker. Pressed when you already reacted with it. */
export function EmojiPick({ size, children, ...props }: BaseProps & VariantProps<typeof pick> & { children: ReactNode }) {
  return (
    <BaseButton type="button" {...props} className={pick({ size })}>
      {children}
    </BaseButton>
  )
}
