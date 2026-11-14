import { Input as BaseInput } from "@ui-sdk/react/input"
import { Textarea as BaseTextarea } from "@ui-sdk/react/textarea"
import type { ComponentProps } from "react"
import { variants, type VariantProps } from "./variants.ts"

const field = variants(
  "w-full min-w-0 rounded-md text-ink outline-none placeholder:text-faint",
  {
    variant: {
      boxed: "border border-line bg-surface px-2.5 focus:border-accent focus:ring-1 focus:ring-accent",
      bare: "border border-transparent bg-transparent px-0 focus:ring-0",
      title: "border border-transparent bg-transparent px-0 text-[22px] font-semibold tracking-tight",
      card: "border border-line bg-raised px-2.5 shadow-card focus:border-accent",
    },
    size: { sm: "h-7 text-xs", md: "h-8 text-[13px]", auto: "" },
  },
  { variant: "boxed", size: "md" },
)

export type InputProps = Omit<ComponentProps<typeof BaseInput>, "className" | "style" | "size"> & VariantProps<typeof field>

export function Input({ variant, size, ...props }: InputProps) {
  return <BaseInput {...props} className={field({ variant, size: variant === "title" ? "auto" : size })} />
}

const area = variants(
  "w-full min-w-0 resize-y rounded-md text-[13px] leading-relaxed text-ink outline-none placeholder:text-faint",
  {
    variant: {
      boxed: "min-h-28 border border-line bg-surface p-2.5 focus:border-accent focus:ring-1 focus:ring-accent",
      comment: "min-h-16 border border-line bg-raised p-2.5 shadow-card focus:border-accent",
    },
  },
  { variant: "boxed" },
)

export type TextareaProps = Omit<ComponentProps<typeof BaseTextarea>, "className" | "style"> & VariantProps<typeof area>

export function Textarea({ variant, ...props }: TextareaProps) {
  return <BaseTextarea {...props} className={area({ variant })} />
}
