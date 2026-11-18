import {
  createTooltipController,
  Tooltip as BaseTooltip,
  TooltipContent as BaseContent,
  TooltipShortcut as BaseShortcut,
  TooltipTrigger as BaseTrigger,
} from "@ui-sdk/react/tooltip"
import type { ComponentProps } from "react"

/**
 * Hover or focus names a control: `<Tooltip><TooltipTrigger render={<Link … />} /><TooltipContent>…</TooltipContent></Tooltip>`.
 * A row of controls (the sidebar's rail) shares one, through `createTooltipController`, so only one shows at a time.
 */
export const Tooltip = BaseTooltip
export { createTooltipController }

/** Renders the control it names (`render`), which keeps its own look. */
export function TooltipTrigger(props: Omit<ComponentProps<typeof BaseTrigger>, "className">) {
  return <BaseTrigger {...props} />
}

export function TooltipContent(props: Omit<ComponentProps<typeof BaseContent>, "className">) {
  return (
    <BaseContent
      side="right"
      sideOffset={8}
      {...props}
      className="flex items-center gap-2 rounded-md bg-ink px-2 py-1 text-xs font-medium whitespace-nowrap text-canvas shadow-pop transition-[opacity,scale] duration-(--motion-fast) ease-motion-out origin-(--transform-origin) data-ending-style:scale-97 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:scale-97 data-starting-style:opacity-0 motion-reduce:transition-none"
    />
  )
}

/** The keys of the tooltip's `shortcut`, or of its own, as the platform shows them (⌘B, Ctrl+B). */
export function TooltipShortcut({ shortcut }: { shortcut?: string }) {
  return <BaseShortcut shortcut={shortcut} className="text-faint" />
}
