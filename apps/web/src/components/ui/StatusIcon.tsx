import type { StatusCategory } from "@cello/contract/entities"

/** Linear-style status glyph: dashed for backlog, empty, half, paused (waiting on Lucas), check, cross. */
export function StatusIcon({ category, color, size = 14 }: { category: StatusCategory; color: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 14 14", "aria-hidden": true, className: "shrink-0" } as const
  switch (category) {
    case "backlog":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke={color} strokeWidth="1.5" strokeDasharray="1.6 1.9" />
        </svg>
      )
    case "unstarted":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke={color} strokeWidth="1.5" />
        </svg>
      )
    case "started":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke={color} strokeWidth="1.5" />
          <path d="M7 3.5 A3.5 3.5 0 0 1 7 10.5 Z" fill={color} />
        </svg>
      )
    case "waiting":
      // Needs input: the work is paused on a question, so a pause mark inside the ring.
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="5.5" fill="none" stroke={color} strokeWidth="1.5" />
          <path d="M5.6 4.9v4.2M8.4 4.9v4.2" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
    case "completed":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6.25" fill={color} />
          <path d="M4.4 7.2 6.2 9 9.7 5.3" fill="none" stroke="var(--surface)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case "canceled":
      return (
        <svg {...common}>
          <circle cx="7" cy="7" r="6.25" fill={color} />
          <path d="M5 5l4 4M9 5l-4 4" stroke="var(--surface)" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      )
  }
}
