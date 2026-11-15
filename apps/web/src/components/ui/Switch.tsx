import { Switch as BaseSwitch, SwitchThumb } from "@ui-sdk/react/switch"
import type { ComponentProps } from "react"

/** Turns a setting on or off, like Display → Show agent cursors. The thumb slides only when it changes. */
export function Switch(props: Omit<ComponentProps<typeof BaseSwitch>, "className" | "children">) {
  return (
    <BaseSwitch
      {...props}
      className="inline-flex h-4.5 w-8 shrink-0 items-center rounded-full bg-line-strong p-0.5 outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring aria-checked:bg-accent motion-reduce:transition-none"
    >
      <SwitchThumb className="size-3.5 rounded-full bg-white shadow-card transition-transform duration-150 in-aria-checked:translate-x-3.5 motion-reduce:transition-none" />
    </BaseSwitch>
  )
}
