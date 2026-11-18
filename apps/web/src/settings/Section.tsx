/**
 * A settings page's scroll area and its column of sections, shared by the main Settings and a project's
 * Settings tab. The column keeps its width but starts at the left, like the Review and Agents pages (CEL-163),
 * so it doesn't jump to the middle when a panel narrows the page.
 */
export function SettingsColumn({ children }: { children: React.ReactNode }) {
  return (
    <div data-settings-scroller="" className="flex-1 overflow-y-auto px-8 py-6">
      <div className="flex max-w-2xl flex-col gap-10">{children}</div>
    </div>
  )
}

/** A titled block of settings: a heading, one line saying what it is for, then its controls. */
export function Section({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <div>
        <h2 className="text-[15px] font-semibold">{title}</h2>
        <p className="text-[13px] text-muted">{description}</p>
      </div>
      {children}
    </section>
  )
}
