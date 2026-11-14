import { Centered } from "../app/Home.tsx"

export function ComingSoon({ what, when }: { what: string; when: string }) {
  return (
    <Centered>
      <p className="text-[15px] font-medium text-ink">{what}</p>
      <p>Coming in {when}.</p>
    </Centered>
  )
}
