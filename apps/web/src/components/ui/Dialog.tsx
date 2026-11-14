import {
  Dialog as BaseDialog,
  DialogBackdrop,
  DialogClose as BaseClose,
  DialogContent as BaseContent,
  DialogDescription as BaseDescription,
  DialogTitle as BaseTitle,
  DialogTrigger,
} from "@ui-sdk/react/dialog"
import type { ComponentProps, ReactNode } from "react"
import { variants, type VariantProps } from "./variants.ts"

export { DialogTrigger }
export const Dialog = BaseDialog

const content = variants(
  "fixed top-[14vh] left-1/2 flex -translate-x-1/2 flex-col gap-4 rounded-xl border border-line bg-surface p-5 text-ink shadow-pop outline-none transition-[opacity,scale] duration-150 data-starting-style:scale-97 data-starting-style:opacity-0 data-ending-style:scale-97 data-ending-style:opacity-0 motion-reduce:transition-none",
  { size: { sm: "w-[min(420px,calc(100vw-32px))]", md: "w-[min(560px,calc(100vw-32px))]" } },
  { size: "md" },
)

export function DialogContent({
  size,
  children,
  ...props
}: Omit<ComponentProps<typeof BaseContent>, "className" | "children"> & VariantProps<typeof content> & { children: ReactNode }) {
  return (
    <>
      <DialogBackdrop className="fixed inset-0 bg-black/30 transition-opacity duration-150 data-starting-style:opacity-0 data-ending-style:opacity-0" />
      <BaseContent {...props} className={content({ size })}>
        {children}
      </BaseContent>
    </>
  )
}

export function DialogTitle(props: Omit<ComponentProps<typeof BaseTitle>, "className">) {
  return <BaseTitle {...props} className="text-[15px] font-semibold" />
}

export function DialogDescription(props: Omit<ComponentProps<typeof BaseDescription>, "className">) {
  return <BaseDescription {...props} className="text-[13px] text-muted" />
}

export function DialogClose(props: Omit<ComponentProps<typeof BaseClose>, "className">) {
  return (
    <BaseClose
      {...props}
      className="inline-flex h-8 items-center justify-center rounded-md px-3 text-[13px] font-medium text-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-ring"
    />
  )
}
