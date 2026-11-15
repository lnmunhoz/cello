import { Button as BaseButton } from "@ui-sdk/react/button"
import { Link, type LinkProps } from "@tanstack/react-router"
import type { ComponentProps, ReactNode } from "react"
import { variants, type VariantProps } from "./variants.ts"

const button = variants(
  "inline-flex shrink-0 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-pending:opacity-70",
  {
    variant: {
      primary: "bg-accent text-accent-ink hover:brightness-110",
      secondary: "border border-line bg-raised text-ink shadow-card hover:bg-hover",
      ghost: "text-muted hover:bg-hover hover:text-ink",
      /** Quiet text in the accent colour that opens more of a list ("Show all 15"). */
      more: "justify-start text-accent hover:bg-hover",
      danger: "text-danger hover:bg-hover",
      /** A button in a page's toolbar, beside Display (the Filter toggle); pressed while what it shows is open. */
      toolbar: "border border-line bg-raised text-ink shadow-card hover:bg-hover aria-pressed:bg-hover",
      /** On the image modal's dark backdrop, in both themes. */
      overlay: "text-white/75 hover:bg-white/12 hover:text-white aria-pressed:bg-white/16 aria-pressed:text-white disabled:hover:bg-transparent",
      /** Floating over the image itself (the modal's ← and →), readable on a light screenshot too. */
      floating: "bg-black/60 text-white/90 shadow-pop hover:bg-black/80 hover:text-white disabled:hover:bg-black/60",
    },
    size: {
      sm: "h-6 px-2 text-xs",
      md: "h-8 px-3 text-[13px]",
      /** As tall as the toolbar's popover buttons (Display). */
      toolbar: "h-7 px-2.5 text-[13px]",
      /** As tall and wide as a row in a list it sits in. */
      row: "h-7 w-full px-2 text-[13px]",
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

export type LinkButtonProps = Omit<LinkProps, "className" | "style"> & VariantProps<typeof button> & { children: ReactNode }

/** An in-app route link that looks like a button: "Go to the board" on a Not found screen. */
export function LinkButton({ variant, size, ...props }: LinkButtonProps) {
  return <Link {...props} className={button({ variant, size })} />
}

/** A link that looks like a button: for evidence and other things that open in a new tab. */
export function ButtonLink({ variant, size, ...props }: ButtonLinkProps) {
  return <a target="_blank" rel="noreferrer" {...props} className={button({ variant, size })} />
}
