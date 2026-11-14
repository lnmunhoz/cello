import { Popover as BasePopover, PopoverContent as BaseContent, PopoverTrigger as BaseTrigger } from "@ui-sdk/react/popover"
import type { ComponentProps } from "react"
import { popupLook } from "./Menu.tsx"
import { variants, type VariantProps } from "./variants.ts"

export const Popover = BasePopover

const trigger = variants(
  "inline-flex items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
  {
    variant: {
      swatch: "size-6 justify-center hover:bg-hover",
      property: "h-8 w-full gap-2 px-2 text-[13px] text-ink hover:bg-hover data-open:bg-hover",
      /** A button in a page's toolbar, like Display. */
      toolbar: "h-7 gap-1.5 border border-line bg-raised px-2.5 text-[13px] font-medium text-ink shadow-card hover:bg-hover data-open:bg-hover",
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
