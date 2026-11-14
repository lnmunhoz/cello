import ReactMarkdown from "react-markdown"

/** Rendered markdown with the app's type scale. Raw HTML is never rendered. */
export function Markdown({ source, empty = "Nothing here yet." }: { source: string; empty?: string }) {
  if (source.trim() === "") return <p className="text-[13px] text-faint">{empty}</p>
  return (
    <div className="space-y-2 text-[13px] leading-relaxed text-ink [&_a]:text-accent [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-line [&_blockquote]:pl-3 [&_blockquote]:text-muted [&_code]:rounded [&_code]:bg-sunken [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[12px] [&_h1]:text-[17px] [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:font-semibold [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-sunken [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown>{source}</ReactMarkdown>
    </div>
  )
}
