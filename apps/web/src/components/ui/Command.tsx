// A search field over a list of commands (the ⌘K bar, CEL-43). The parts own their look; callers
// compose them and pick a `size` where there's more than one.
import {
  Command as BaseCommand,
  CommandEmpty as BaseEmpty,
  CommandGroup as BaseGroup,
  CommandGroupLabel as BaseGroupLabel,
  CommandInput as BaseInput,
  CommandItem as BaseItem,
  CommandList as BaseList,
  CommandShortcut as BaseShortcut,
} from "@ui-sdk/react/command"
import type { ComponentProps } from "react"
import { variants, type VariantProps } from "./variants.ts"

export function Command(props: Omit<ComponentProps<typeof BaseCommand>, "className">) {
  return <BaseCommand {...props} className="flex min-h-0 flex-1 flex-col" />
}

export function CommandInput(props: Omit<ComponentProps<typeof BaseInput>, "className">) {
  return <BaseInput {...props} className="h-12 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint" />
}

const list = variants(
  "min-h-0 overflow-y-auto overscroll-contain p-1.5 scroll-py-8",
  { size: { palette: "max-h-[min(520px,64vh)]", peek: "h-[min(480px,62vh)]" } },
  { size: "palette" },
)

export function CommandList({ size, ...props }: Omit<ComponentProps<typeof BaseList>, "className"> & VariantProps<typeof list>) {
  return <BaseList {...props} className={list({ size })} />
}

export function CommandGroup(props: Omit<ComponentProps<typeof BaseGroup>, "className">) {
  return <BaseGroup {...props} className="pb-1" />
}

export function CommandGroupLabel(props: Omit<ComponentProps<typeof BaseGroupLabel>, "className">) {
  return <BaseGroupLabel {...props} className="flex h-7 items-center justify-between px-2.5 text-[11px] font-medium tracking-wide text-faint uppercase" />
}

const item = variants(
  "flex cursor-default items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-ink outline-none data-highlighted:bg-selected data-disabled:opacity-50",
  { size: { row: "min-h-9 py-1.5", tall: "min-h-12 py-2" } },
  { size: "row" },
)

export function CommandItem({ size, ...props }: Omit<ComponentProps<typeof BaseItem>, "className"> & VariantProps<typeof item>) {
  return <BaseItem {...props} className={item({ size })} />
}

export function CommandEmpty(props: Omit<ComponentProps<typeof BaseEmpty>, "className">) {
  return <BaseEmpty {...props} className="px-4 py-10 text-center text-[13px] text-muted not-data-empty:hidden" />
}

/** A shortcut's keys for this platform (⌘B on a Mac, Ctrl+B elsewhere), as key caps. */
export function CommandShortcut(props: Omit<ComponentProps<typeof BaseShortcut>, "className">) {
  return <BaseShortcut {...props} className="ml-auto flex gap-1 font-sans text-[11px] text-muted" />
}

/** A key cap, for the footer's hints and shortcuts written out by hand ("G then R"). */
export function Kbd({ children }: { children: string }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-sunken px-1 font-sans text-[11px] leading-none text-muted">
      {children}
    </kbd>
  )
}
