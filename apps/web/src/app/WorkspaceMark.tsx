// A workspace's mark in the sidebar: its first letter. While no workspace has loaded yet, the Cello
// icon, so the app never shows a placeholder letter.
export function WorkspaceMark({ name }: { name?: string | undefined }) {
  if (!name) return <img aria-hidden src="/icons/icon.svg" alt="" className="size-5 shrink-0 rounded-md" />
  return (
    <span aria-hidden className="flex size-5 shrink-0 items-center justify-center rounded-md bg-accent text-[11px] font-semibold text-accent-ink">
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}
