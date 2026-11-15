import {
  SegmentedControl as BaseControl,
  SegmentedControlIndicator as BaseIndicator,
  SegmentedControlItem as BaseItem,
} from "@ui-sdk/react/segmented-control"
import { createContext, use, type ComponentProps, type ReactNode } from "react"
import { variants, type VariantProps } from "./variants.ts"

const control = variants(
  "relative isolate grid auto-cols-fr grid-flow-col gap-0.5 bg-sunken p-0.5",
  { size: { md: "rounded-lg", sm: "rounded-md" } },
  { size: "md" },
)

const indicator = variants(
  "absolute top-(--segmented-control-indicator-top) left-(--segmented-control-indicator-left) -z-10 h-(--segmented-control-indicator-height) w-(--segmented-control-indicator-width) border border-line bg-raised shadow-card transition-[left,width] duration-150 motion-reduce:transition-none",
  { size: { md: "rounded-md", sm: "rounded" } },
  { size: "md" },
)

const item = variants(
  "inline-flex items-center justify-center gap-1.5 font-medium text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring aria-checked:text-ink",
  { size: { md: "h-8 rounded-md px-3 text-[13px]", sm: "h-5 rounded px-1.5 text-[11px]" } },
  { size: "md" },
)

type Size = VariantProps<typeof control>["size"]
const SizeContext = createContext<Size>("md")

/**
 * Pick one of a few options, like List / Board. Works as a radio group; the raised
 * background slides to the choice only when it changes. sm: a compact one for a footer (the ⌘K bar's layout).
 */
export function SegmentedControl({ children, size, ...props }: Omit<ComponentProps<typeof BaseControl>, "className" | "children"> & { children: ReactNode } & VariantProps<typeof control>) {
  return (
    <BaseControl {...props} className={control({ size })}>
      <BaseIndicator className={indicator({ size })} />
      <SizeContext value={size}>{children}</SizeContext>
    </BaseControl>
  )
}

export function SegmentedControlItem(props: Omit<ComponentProps<typeof BaseItem>, "className">) {
  return <BaseItem {...props} className={item({ size: use(SizeContext) })} />
}
