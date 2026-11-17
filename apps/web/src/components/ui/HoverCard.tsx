import { HoverCard as BaseHoverCard, HoverCardContent as BaseContent, HoverCardTrigger as BaseTrigger } from "@ui-sdk/react/hover-card"
import type { ComponentProps } from "react"
import { popupLook } from "./Menu.tsx"

/**
 * A preview of what a link points to (a task, CEL-142), shown when the pointer rests on the link or
 * keyboard focus stays on it, and kept open while the pointer is over the card, so its own links work.
 * Esc or leaving closes it; a click still follows the link. `delay` is how long the pointer rests first.
 * `<HoverCard><HoverCardTrigger render={<a … />} /><HoverCardContent>…</HoverCardContent></HoverCard>`.
 */
export function HoverCard({ delay = 300, closeDelay = 150, ...props }: ComponentProps<typeof BaseHoverCard>) {
  return <BaseHoverCard delay={delay} closeDelay={closeDelay} {...props} />
}

/** Renders the link it previews (`render`), which keeps its own look. */
export function HoverCardTrigger(props: Omit<ComponentProps<typeof BaseTrigger>, "className">) {
  return <BaseTrigger {...props} />
}

/**
 * The card, below the link and lined up with its start, flipping above when there's no room. It renders
 * in the page's body, not beside the link, so the text around the link (a page's 17 px prose, its link
 * and paragraph styles) doesn't restyle it.
 */
export function HoverCardContent(props: Omit<ComponentProps<typeof BaseContent>, "className">) {
  return (
    <BaseContent
      side="bottom"
      align="start"
      sideOffset={6}
      collisionPadding={12}
      container={typeof document === "undefined" ? undefined : document.body}
      {...props}
      className={`${popupLook} p-3`}
    />
  )
}
