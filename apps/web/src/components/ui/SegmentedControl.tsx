import {
  SegmentedControl as BaseControl,
  SegmentedControlIndicator as BaseIndicator,
  SegmentedControlItem as BaseItem,
} from "@ui-sdk/react/segmented-control"
import type { ComponentProps, ReactNode } from "react"

/**
 * Pick one of a few options, like List / Board. Works as a radio group; the raised
 * background slides to the choice only when it changes.
 */
export function SegmentedControl({ children, ...props }: Omit<ComponentProps<typeof BaseControl>, "className" | "children"> & { children: ReactNode }) {
  return (
    <BaseControl {...props} className="relative isolate grid auto-cols-fr grid-flow-col gap-0.5 rounded-lg bg-sunken p-0.5">
      <BaseIndicator className="absolute top-(--segmented-control-indicator-top) left-(--segmented-control-indicator-left) -z-10 h-(--segmented-control-indicator-height) w-(--segmented-control-indicator-width) rounded-md border border-line bg-raised shadow-card transition-[left,width] duration-150 motion-reduce:transition-none" />
      {children}
    </BaseControl>
  )
}

export function SegmentedControlItem(props: Omit<ComponentProps<typeof BaseItem>, "className">) {
  return (
    <BaseItem
      {...props}
      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-[13px] font-medium text-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-ring aria-checked:text-ink"
    />
  )
}
