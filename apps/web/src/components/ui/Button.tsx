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
      /** On the image modal's dark backdrop, in both themes. */
      overlay: "text-white/75 hover:bg-white/12 hover:text-white aria-pressed:bg-white/16 aria-pressed:text-white disabled:hover:bg-transparent",
      /** Floating over the image itself (the modal's ← and →), readable on a light screenshot too. */
      floating: "bg-black/60 text-white/90 shadow-pop hover:bg-black/80 hover:text-white disabled:hover:bg-black/60",
    },
    size: {
      sm: "h-6 px-2 text-xs",
      md: "h-8 px-3 text-[13px]",
      icon: "size-6 text-muted",
      iconMd: "size-7",
      iconLg: "size-9",
    },
  },
  { variant: "secondary", size: "md" },
)

export type ButtonProps = Omit<ComponentProps<typeof BaseButton>, "className" | "style"> & VariantProps<typeof button>

export function Button({ variant, size, type = "button", ...props }: ButtonProps) {
  return <BaseButton type={type} {...props} className={button({ variant, size })} />
}

export type ButtonLinkProps = Omit<ComponentProps<"a">, "className" | "style"> & VariantProps<typeof button>

/** A link that looks like a button: for evidence and other things that open in a new tab. */
export function ButtonLink({ variant, size, ...props }: ButtonLinkProps) {
  return <a target="_blank" rel="noreferrer" {...props} className={button({ variant, size })} />
}
