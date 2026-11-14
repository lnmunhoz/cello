import type { Priority } from "@cello/contract/entities"

export const PRIORITY_LABELS: Record<Priority, string> = { 0: "No priority", 1: "Urgent", 2: "High", 3: "Medium", 4: "Low" }

/** Bars for high/medium/low, a mark for urgent, three dots for none. */
export function PriorityIcon({ priority }: { priority: Priority }) {
  const common = { width: 14, height: 14, viewBox: "0 0 14 14", "aria-label": PRIORITY_LABELS[priority], role: "img", className: "shrink-0" } as const
  if (priority === 0) {
    return (
      <svg {...common}>
        {[3, 7, 11].map((x) => (
          <rect key={x} x={x - 1} y="6.25" width="2" height="1.5" rx="0.5" fill="var(--faint)" />
        ))}
      </svg>
    )
  }
  if (priority === 1) {
    return (
      <svg {...common}>
        <rect x="1" y="1" width="12" height="12" rx="3" fill="#e2653b" />
        <rect x="6.25" y="3.5" width="1.5" height="4.5" rx="0.75" fill="white" />
        <rect x="6.25" y="9.25" width="1.5" height="1.5" rx="0.75" fill="white" />
      </svg>
    )
  }
  const filled = 5 - priority // high 3, medium 2, low 1
  return (
    <svg {...common}>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={1.5 + i * 4} y={9 - i * 3} width="3" height={3.5 + i * 3} rx="1" fill={i < filled ? "var(--muted)" : "var(--line-strong)"} />
      ))}
    </svg>
  )
}
