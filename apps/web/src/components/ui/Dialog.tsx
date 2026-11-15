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

const PANEL =
  "fixed top-[14vh] left-1/2 flex -translate-x-1/2 flex-col gap-4 rounded-xl border border-line bg-surface p-5 text-ink shadow-pop transition-[opacity,scale] data-starting-style:scale-97 data-starting-style:opacity-0 data-ending-style:scale-97 data-ending-style:opacity-0"

/**
 * sm and md: a panel near the top, over a dim. screen: the whole window on a dark backdrop, the same in
 * both themes (the image modal); its content lays out its own toolbar and stage.
 */
const content = variants(
  "outline-none duration-150 motion-reduce:transition-none",
  {
    size: {
      sm: `${PANEL} w-[min(420px,calc(100vw-32px))]`,
      md: `${PANEL} w-[min(560px,calc(100vw-32px))]`,
      screen: "fixed inset-0 flex flex-col bg-[rgb(9_9_11/0.99)] text-white transition-opacity data-starting-style:opacity-0 data-ending-style:opacity-0",
    },
  },
  { size: "md" },
)

const backdrop = variants(
  "fixed inset-0 transition-opacity duration-150 data-starting-style:opacity-0 data-ending-style:opacity-0",
  { size: { sm: "bg-black/30", md: "bg-black/30", screen: "bg-transparent" } },
  { size: "md" },
)

export function DialogContent({
  size,
  children,
  ...props
}: Omit<ComponentProps<typeof BaseContent>, "className" | "children"> & VariantProps<typeof content> & { children: ReactNode }) {
  return (
    <>
      <DialogBackdrop className={backdrop({ size })} />
      <BaseContent {...props} className={content({ size })}>
        {children}
      </BaseContent>
    </>
  )
}

const title = variants("font-semibold", { size: { md: "text-[15px]", sm: "min-w-0 truncate text-[13px]" } }, { size: "md" })

/** sm: one line that truncates, for a toolbar (the image modal's caption). */
export function DialogTitle({ size, ...props }: Omit<ComponentProps<typeof BaseTitle>, "className"> & VariantProps<typeof title>) {
  return <BaseTitle {...props} className={title({ size })} />
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
