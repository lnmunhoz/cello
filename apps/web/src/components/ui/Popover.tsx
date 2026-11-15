import { Popover as BasePopover, PopoverContent as BaseContent, PopoverTrigger as BaseTrigger } from "@ui-sdk/react/popover"
import type { ComponentProps } from "react"
import { popupLook } from "./Menu.tsx"
import { variants, type VariantProps } from "./variants.ts"

export const Popover = BasePopover

const trigger = variants(
  "inline-flex rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
  {
    variant: {
      swatch: "size-6 items-center justify-center hover:bg-hover",
      property: "h-8 w-full items-center gap-2 px-2 text-[13px] text-ink hover:bg-hover data-open:bg-hover",
      /** A button in a page's toolbar, like Display. */
      toolbar: "h-7 items-center gap-1.5 border border-line bg-raised px-2.5 text-[13px] font-medium text-ink shadow-card hover:bg-hover data-open:bg-hover",
      /** A quiet line of small print, like the running build at the foot of the sidebar. */
      footer: "w-full min-w-0 flex-col items-start px-2 py-1 text-left text-[11px] leading-4 text-faint tabular-nums hover:bg-hover hover:text-muted data-open:bg-hover data-open:text-muted",
    },
  },
  { variant: "property" },
)

export function PopoverTrigger({ variant, ...props }: Omit<ComponentProps<typeof BaseTrigger>, "className"> & VariantProps<typeof trigger>) {
  return <BaseTrigger {...props} className={trigger({ variant })} />
}

export function PopoverContent(props: Omit<ComponentProps<typeof BaseContent>, "className">) {
  return <BaseContent sideOffset={4} align="start" {...props} className={`${popupLook} p-2`} />
}
