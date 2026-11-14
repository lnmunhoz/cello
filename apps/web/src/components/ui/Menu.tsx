import {
  Menu as BaseMenu,
  MenuContent as BaseContent,
  MenuItem as BaseItem,
  MenuSeparator as BaseSeparator,
  MenuTrigger as BaseTrigger,
} from "@ui-sdk/react/menu"
import type { ComponentProps } from "react"
import { variants, type VariantProps } from "./variants.ts"

export const Menu = BaseMenu

const trigger = variants(
  "inline-flex items-center justify-center gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
  {
    variant: {
      icon: "size-6 text-muted hover:bg-hover hover:text-ink data-open:bg-hover",
      row: "h-7 w-full justify-start px-2 text-[13px] font-medium text-ink hover:bg-hover data-open:bg-hover",
    },
  },
  { variant: "icon" },
)

export function MenuTrigger({ variant, ...props }: Omit<ComponentProps<typeof BaseTrigger>, "className"> & VariantProps<typeof trigger>) {
  return <BaseTrigger {...props} className={trigger({ variant })} />
}

export const popupLook =
  "min-w-44 rounded-lg border border-line bg-raised p-1 text-[13px] text-ink shadow-pop outline-none transition-[opacity,scale] duration-100 origin-(--transform-origin) data-starting-style:scale-97 data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none"

export function MenuContent(props: Omit<ComponentProps<typeof BaseContent>, "className">) {
  return <BaseContent sideOffset={4} align="start" {...props} className={popupLook} />
}

const item = variants(
  "flex h-7 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-hover data-disabled:opacity-50",
  { variant: { default: "text-ink", danger: "text-danger" } },
  { variant: "default" },
)

export function MenuItem({ variant, ...props }: Omit<ComponentProps<typeof BaseItem>, "className"> & VariantProps<typeof item>) {
  return <BaseItem {...props} className={item({ variant })} />
}

export function MenuSeparator() {
  return <BaseSeparator className="my-1 h-px bg-line" />
}
