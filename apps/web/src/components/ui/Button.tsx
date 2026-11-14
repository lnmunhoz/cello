import { Button as BaseButton } from "@ui-sdk/react/button"
import type { ComponentProps } from "react"
import { variants, type VariantProps } from "./variants.ts"

const button = variants(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-pending:opacity-70",
  {
    variant: {
      primary: "bg-accent text-accent-ink hover:brightness-110",
      secondary: "border border-line bg-raised text-ink shadow-card hover:bg-hover",
      ghost: "text-muted hover:bg-hover hover:text-ink",
      danger: "text-danger hover:bg-hover",
    },
    size: {
      sm: "h-6 px-2 text-xs",
      md: "h-8 px-3 text-[13px]",
      icon: "size-6 text-muted",
      iconMd: "size-7",
    },
  },
  { variant: "secondary", size: "md" },
)

export type ButtonProps = Omit<ComponentProps<typeof BaseButton>, "className" | "style"> & VariantProps<typeof button>

export function Button({ variant, size, type = "button", ...props }: ButtonProps) {
  return <BaseButton type={type} {...props} className={button({ variant, size })} />
}
