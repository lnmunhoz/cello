import {
  Select as BaseSelect,
  SelectContent,
  SelectEmpty,
  SelectInput,
  SelectItem,
  SelectItemIcon,
  SelectItemIndicator,
  SelectList,
  SelectTrigger,
} from "@ui-sdk/react/select"
import { CheckIcon } from "lucide-react"
import type { ReactNode } from "react"
import { popupLook } from "./Menu.tsx"
import { variants, type VariantProps } from "./variants.ts"

export interface Option {
  readonly value: string
  readonly label: string
  readonly icon?: ReactNode
}

const trigger = variants(
  "inline-flex min-w-0 items-center gap-2 rounded-md text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring",
  {
    variant: {
      /** A row in the task panel's property list. */
      property: "h-8 w-full px-2 text-ink hover:bg-hover data-open:bg-hover data-placeholder:text-muted",
      /** A small chip, like on a card. */
      chip: "h-6 border border-line px-1.5 text-xs text-muted hover:bg-hover hover:text-ink",
      boxed: "h-8 w-full border border-line bg-surface px-2.5 text-ink hover:bg-hover",
    },
  },
  { variant: "property" },
)

interface CommonProps extends VariantProps<typeof trigger> {
  readonly options: ReadonlyArray<Option>
  readonly label: string
  readonly placeholder?: string
  /** Show a search field above the options. */
  readonly searchable?: boolean
  /** Replaces the selected value's label and icon in the trigger. */
  readonly display?: ReactNode
}

interface SingleProps extends CommonProps {
  readonly multiple?: false
  readonly value: string | null
  readonly onValueChange: (value: string | null) => void
}

interface MultipleProps extends CommonProps {
  readonly multiple: true
  readonly value: ReadonlyArray<string>
  readonly onValueChange: (value: string[]) => void
}

export function Select(props: SingleProps | MultipleProps) {
  const { options, label, placeholder, searchable, display, variant } = props
  const rest = props.multiple
    ? { multiple: true as const, value: [...props.value], onValueChange: (v: unknown) => props.onValueChange(v as string[]) }
    : { value: props.value, onValueChange: (v: unknown) => props.onValueChange(v as string | null) }
  return (
    <BaseSelect
      {...(rest as object)}
      items={options.map((o) => ({ value: o.value, label: o.label }))}
      placeholder={placeholder}
      modal="pointer"
    >
      <SelectTrigger aria-label={label} className={trigger({ variant })}>
        {display ?? <Selected option={props.multiple ? undefined : options.find((o) => o.value === props.value)} placeholder={placeholder} />}
      </SelectTrigger>
      <SelectContent sideOffset={4} align="start" className={`${popupLook} max-h-80 w-60 overflow-y-auto`}>
        {searchable ? (
          <SelectInput
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder={`${label}…`}
            className="mb-1 h-8 w-full border-b border-line bg-transparent px-2 text-[13px] outline-none placeholder:text-faint"
          />
        ) : null}
        <SelectEmpty className="px-2 py-1.5 text-muted">No matches</SelectEmpty>
        <SelectList>
          {options.map((o) => (
            <SelectItem
              key={o.value}
              value={o.value}
              label={o.label}
              className="flex h-7 cursor-default items-center gap-2 rounded-md px-2 outline-none data-highlighted:bg-hover"
            >
              {o.icon ? <SelectItemIcon className="flex size-4 items-center justify-center">{o.icon}</SelectItemIcon> : null}
              <span className="flex-1 truncate">{o.label}</span>
              <SelectItemIndicator className="text-muted">
                <CheckIcon className="size-3.5" />
              </SelectItemIndicator>
            </SelectItem>
          ))}
        </SelectList>
      </SelectContent>
    </BaseSelect>
  )
}

/** The trigger's content: the chosen option's icon and label, or the placeholder. */
function Selected({ option, placeholder }: { option: Option | undefined; placeholder: string | undefined }) {
  if (!option) return <span className="truncate text-muted">{placeholder}</span>
  return (
    <>
      {option.icon ? <span className="flex size-4 shrink-0 items-center justify-center">{option.icon}</span> : null}
      <span className="truncate">{option.label}</span>
    </>
  )
}
