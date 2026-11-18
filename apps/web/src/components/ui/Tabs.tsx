import { Tabs as BaseTabs, TabsList as BaseList, TabsPanel as BasePanel, TabsTab as BaseTab } from "@ui-sdk/react/tabs"
import type { ComponentProps } from "react"

export const Tabs = BaseTabs

/** A small segmented switch, like Write / Preview. */
export function TabsList(props: Omit<ComponentProps<typeof BaseList>, "className">) {
  return <BaseList {...props} className="inline-flex h-7 items-center gap-0.5 rounded-md bg-sunken p-0.5" />
}

export function TabsTab(props: Omit<ComponentProps<typeof BaseTab>, "className">) {
  return (
    <BaseTab
      {...props}
      className="inline-flex h-6 items-center rounded px-2 text-xs font-medium text-muted outline-none transition-[color,background-color,box-shadow] duration-(--motion-fast) ease-motion-out hover:text-ink focus-visible:ring-2 focus-visible:ring-ring data-selected:bg-raised data-selected:text-ink data-selected:shadow-card"
    />
  )
}

export function TabsPanel(props: Omit<ComponentProps<typeof BasePanel>, "className">) {
  return <BasePanel {...props} className="outline-none" />
}
