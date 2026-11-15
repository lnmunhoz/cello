import {
  Tooltip as BaseTooltip,
  TooltipContent as BaseContent,
  TooltipShortcut as BaseShortcut,
  TooltipTrigger as BaseTrigger,
} from "@ui-sdk/react/tooltip"
import type { ComponentProps } from "react"

/** Hover or focus names a control: `<Tooltip><TooltipTrigger render={<Link … />} /><TooltipContent>…</TooltipContent></Tooltip>`. */
export const Tooltip = BaseTooltip

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
      className="flex items-center gap-2 rounded-md bg-ink px-2 py-1 text-xs font-medium whitespace-nowrap text-canvas shadow-pop transition-opacity duration-100 data-ending-style:opacity-0 data-instant:transition-none data-starting-style:opacity-0 motion-reduce:transition-none"
    />
  )
}

/** The tooltip's `shortcut` as the platform shows it (⌘B, Ctrl+B). */
export function TooltipShortcut() {
  return <BaseShortcut className="text-faint" />
}
