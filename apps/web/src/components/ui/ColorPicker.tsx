import { Popover, PopoverContent, PopoverTrigger } from "./Popover.tsx"

export const PALETTE = ["#95999f", "#5e6ad2", "#26b5ce", "#4cb782", "#f2c94c", "#f2994a", "#eb5757", "#bb87fc", "#ec6cb9", "#6b6f76"] as const

/** A swatch that opens a small palette. */
export function ColorPicker({ value, onChange, label }: { value: string; onChange: (color: string) => void; label: string }) {
  return (
    <Popover>
      <PopoverTrigger variant="swatch" aria-label={label}>
        <i className="size-3 rounded-full" style={{ background: value }} />
      </PopoverTrigger>
      <PopoverContent aria-label={label}>
        <div className="grid grid-cols-5 gap-1">
          {PALETTE.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={color}
              aria-pressed={color === value}
              onClick={() => onChange(color)}
              className="flex size-7 items-center justify-center rounded-md outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-selected"
            >
              <i className="size-3.5 rounded-full" style={{ background: color }} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
