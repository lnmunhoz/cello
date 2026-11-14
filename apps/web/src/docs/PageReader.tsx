// The page reader, after the doc kit Lucas uses for artifact pages: a sticky section list that marks
// where you are (a menu when the reader is narrow, e.g. in a panel), a reading column, the summary,
// the linked tasks and the version history. Reading the latest version, a republish shows up live:
// the changed sections flash in the publisher's color and the scroll position stays.
import type { BoardState } from "@cello/client/sync/applyEvents"
import { documentBySlug } from "@cello/client/sync/documents"
import { projectByKey } from "@cello/client/sync/selectors"
import type { Document, DocumentTask, Project } from "@cello/contract/entities"
import { changedSections, pagePath, readerContent, type Section, sectionsOf, splitFrontmatter, summaryOf } from "@cello/shared/document"
import { parseTaskKey } from "@cello/shared/taskKey"
import { useAtomValue } from "@effect/atom-react"
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { CheckIcon, ChevronDownIcon, LinkIcon, ListIcon } from "lucide-react"
import { type RefObject, useEffect, useRef, useState } from "react"
import { Centered } from "../app/Home.tsx"
import { Button } from "../components/ui/Button.tsx"
import { Menu, MenuContent, MenuItem, MenuTrigger } from "../components/ui/Menu.tsx"
import { toast } from "../components/ui/Toast.tsx"
import { documentHistoryFamily, pageFamily } from "../lib/cello.ts"
import { relativeTime } from "../lib/format.ts"
import { useBoard } from "../lib/hooks.ts"
import { KIND_LABELS } from "./kinds.tsx"
import { type Flash, PageBody } from "./PageBody.tsx"

export function PageReader() {
  const { projectKey, slug } = useParams({ from: "/$projectKey/pages/$slug" })
  const { version, embed } = useSearch({ from: "/$projectKey/pages/$slug" })
  const board = useBoard()
  const project = board ? projectByKey(board, projectKey) : undefined
  if (!board || !project) return null
  return <PageLoader key={`${project.key}/${slug}`} board={board} project={project} slug={slug} pinned={version} embed={embed === 1} />
}

function PageLoader({ board, project, slug, pinned, embed }: { board: BoardState; project: Project; slug: string; pinned: number | undefined; embed: boolean }) {
  const ref = `${project.key}/${slug}`
  const result = useAtomValue(pageFamily(pinned === undefined ? ref : `${ref}@${pinned}`))
  if (AsyncResult.isSuccess(result)) return <Reader board={board} project={project} document={result.value} pinned={pinned} embed={embed} />
  if (AsyncResult.isFailure(result)) {
    return (
      <Centered>
        <p className="text-[15px] font-medium text-ink">{pinned === undefined ? `No page “${slug}” in ${project.name}` : `No version ${pinned} of “${slug}”`}</p>
        <Link to="/$projectKey/docs" params={{ projectKey: project.key }} className="text-accent underline">
          See the project’s docs
        </Link>
      </Centered>
    )
  }
  return <Centered>Loading the page…</Centered>
}

/** What the reader saw last, to tell which sections a newer version changed. */
interface Seen {
  readonly version: number
  readonly content: string
}

function Reader({ board, project, document, pinned, embed }: { board: BoardState; project: Project; document: Document; pinned: number | undefined; embed: boolean }) {
  const scroller = useRef<HTMLDivElement>(null)
  const latest = documentBySlug(board, project.id, document.slug)
  const content = readerContent(document.body, document.title)
  const sections = sectionsOf(content)
  const { current, choose } = useCurrentSection(scroller, sections)

  const [seen, setSeen] = useState<Seen>({ version: document.version, content })
  const [flash, setFlash] = useState<Flash | null>(null)
  const [notice, setNotice] = useState<{ readonly version: number; readonly text: string } | null>(null)
  if (seen.version !== document.version) {
    setSeen({ version: document.version, content })
    if (pinned === undefined && document.version > seen.version) {
      setFlash({ version: document.version, color: document.updatedBy.color, ids: changedSections(seen.content, content) })
      setNotice({ version: document.version, text: `Updated to version ${document.version} by ${document.updatedBy.name}` })
    }
  }
  const endFlash = (id: string) =>
    setFlash((f) => {
      const ids = f?.ids.filter((i) => i !== id) ?? []
      return f === null || ids.length === 0 ? null : { ...f, ids }
    })

  // Opened with #section: go there once the page has rendered.
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1))
    if (id) scroller.current?.querySelector(`[id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" })
  }, [])

  /** Scrolls to a section and marks it current; `smooth` unless motion is reduced (a closing menu's focus would stop a smooth scroll). */
  const goTo = (id: string, smooth = true) => {
    choose(id)
    scroller.current
      ?.querySelector(`[id="${CSS.escape(id)}"]`)
      ?.scrollIntoView({ block: "start", behavior: smooth && !matchMedia("(prefers-reduced-motion: reduce)").matches ? "smooth" : "auto" })
  }

  const { frontmatter } = splitFrontmatter(document.body)
  // The summary leads the page unless it's just the first paragraph, which the page shows anyway.
  const lead = document.summary !== "" && (frontmatter["summary"] !== undefined || document.summary !== summaryOf(document.body)) ? document.summary : null
  const tasks = latest?.tasks ?? document.tasks
  const latestVersion = latest?.version ?? document.version
  const archived = (latest ?? document).archivedAt !== null

  return (
    <div ref={scroller} data-page-reader="" className="@container min-h-0 flex-1 overflow-y-auto bg-surface">
      <div
        className={`mx-auto px-8 pt-10 pb-24 @max-[900px]:px-4 @max-[900px]:pt-6 ${sections.length > 0 ? "grid max-w-[1120px] grid-cols-[210px_minmax(0,1fr)] gap-14 @max-[900px]:block" : "max-w-[820px]"}`}
      >
        {sections.length > 0 ? (
          <nav aria-label="Sections" className="sticky top-8 max-h-[calc(100vh-64px)] self-start overflow-y-auto @max-[900px]:hidden">
            <p className="mb-2.5 text-xs font-semibold tracking-[0.08em] text-muted uppercase">On this page</p>
            <ol className="flex flex-col gap-0.5 border-l border-line">
              {sections.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    aria-current={current === s.id ? "location" : undefined}
                    onClick={(e) => {
                      e.preventDefault()
                      goTo(s.id)
                    }}
                    className={`-ml-px block border-l-2 border-transparent py-1 pr-2 text-[13px] leading-snug text-muted outline-none hover:text-ink focus-visible:text-ink focus-visible:underline aria-[current=location]:border-accent aria-[current=location]:font-medium aria-[current=location]:text-accent ${s.level === 3 ? "pl-6" : "pl-3.5"}`}
                  >
                    {s.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        ) : null}

        <article aria-labelledby="page-title" className="min-w-0 max-w-[760px]">
          <header className="mb-2 border-b border-line pb-7">
            <p className="mb-2 text-xs font-semibold tracking-[0.1em] text-accent uppercase">
              {KIND_LABELS[document.kind]} · {project.name}
              {archived ? <span className="ml-2 rounded-full bg-sunken px-2 py-0.5 tracking-normal text-muted normal-case">Archived</span> : null}
            </p>
            <h1 id="page-title" className="mb-4 text-[40px] leading-[1.08] font-bold tracking-[-0.02em] text-balance @max-[900px]:text-[30px]">
              {document.title}
            </h1>
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[14px] text-muted">
              <li>
                By <b className="font-medium text-ink">{document.updatedBy.name}</b>
                {document.updatedBy.session ? <span className="text-faint"> · session {document.updatedBy.session.slice(0, 8)}</span> : null}
              </li>
              <li>
                {pinned === undefined ? "Updated" : "Saved"} <b className="font-medium text-ink">{relativeTime(document.updatedAt)}</b>
              </li>
              <li>
                <VersionMenu documentId={document.id} shown={document.version} latest={latestVersion} />
              </li>
              <li>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const url = new URL(pagePath(project.key, document.slug), location.origin).href
                    void navigator.clipboard?.writeText(url).then(() => toast("Link copied"))
                  }}
                >
                  <LinkIcon aria-hidden className="size-3.5" />
                  Copy link
                </Button>
              </li>
            </ul>
            {lead ? <p className="mt-5 text-[19px] leading-relaxed text-ink">{lead}</p> : null}
            {tasks.length > 0 ? <TaskChips board={board} tasks={tasks} embed={embed} /> : null}
            <p role="status" className="empty:hidden">
              {notice ? (
                <span
                  key={notice.version}
                  className="page-notice mt-4 inline-flex items-center gap-2 rounded-full border border-line bg-raised px-3 py-1 text-[13px] text-ink shadow-card"
                  onAnimationEnd={() => setNotice(null)}
                >
                  <i aria-hidden className="size-2 rounded-full" style={{ background: document.updatedBy.color }} />
                  {notice.text}
                </span>
              ) : null}
            </p>
          </header>

          {sections.length > 0 ? <SectionMenu sections={sections} current={current} onPick={(id) => goTo(id, false)} /> : null}

          {pinned !== undefined ? (
            <div role="note" className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-sunken px-4 py-3 text-[14px] text-ink">
              <span>
                You’re reading version {document.version} of {latestVersion}, saved {relativeTime(document.updatedAt)} by {document.updatedBy.name}.
              </span>
              <Link from="/$projectKey/pages/$slug" search={(s) => ({ ...s, version: undefined })} className="font-medium text-accent underline">
                Read the latest
              </Link>
            </div>
          ) : null}

          <PageBody content={content} flash={flash} onFlashEnd={endFlash} />
        </article>
      </div>
    </div>
  )
}

/** The section list folded into a menu, for a narrow reader (a phone, a panel). */
function SectionMenu({ sections, current, onPick }: { sections: ReadonlyArray<Section>; current: string | null; onPick: (id: string) => void }) {
  const title = sections.find((s) => s.id === current)?.title ?? sections[0]!.title
  return (
    <div className="sticky top-0 z-10 -mx-4 hidden items-center gap-2 border-b border-line bg-surface/95 px-4 py-2 backdrop-blur @max-[900px]:flex">
      <Menu onAction={(id) => onPick(String(id))}>
        <MenuTrigger variant="chip" aria-label="On this page">
          <ListIcon aria-hidden className="size-3.5 text-muted" />
          <span className="max-w-[60vw] truncate">{title}</span>
          <ChevronDownIcon aria-hidden className="size-3.5 text-muted" />
        </MenuTrigger>
        <MenuContent>
          {sections.map((s) => (
            <MenuItem key={s.id} value={s.id}>
              <span className={s.level === 3 ? "pl-3" : ""}>{s.title}</span>
              {s.id === current ? <CheckIcon aria-label="You’re here" className="ml-auto size-3.5 text-accent" /> : null}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>
    </div>
  )
}

/** Picks a version from the history; the latest drops `?version`, so it updates live again. */
function VersionMenu({ documentId, shown, latest }: { documentId: string; shown: number; latest: number }) {
  const navigate = useNavigate({ from: "/$projectKey/pages/$slug" })
  return (
    <Menu
      onAction={(value) => {
        const version = Number(value)
        void navigate({ search: (s) => ({ ...s, version: version === latest ? undefined : version }) })
      }}
    >
      <MenuTrigger variant="chip" aria-label="Version history">
        Version {shown}
        {shown !== latest ? <span className="text-muted">of {latest}</span> : null}
        <ChevronDownIcon aria-hidden className="size-3.5 text-muted" />
      </MenuTrigger>
      <MenuContent>
        <Versions documentId={documentId} shown={shown} latest={latest} />
      </MenuContent>
    </Menu>
  )
}

function Versions({ documentId, shown, latest }: { documentId: string; shown: number; latest: number }) {
  const result = useAtomValue(documentHistoryFamily(documentId))
  if (!AsyncResult.isSuccess(result)) {
    return (
      <MenuItem value="loading" disabled>
        Loading versions…
      </MenuItem>
    )
  }
  return result.value.map((v) => (
    <MenuItem key={v.version} value={String(v.version)}>
      <span className="font-medium">Version {v.version}</span>
      {v.version === latest ? <span className="text-xs text-accent">Latest</span> : null}
      <span className="text-muted">
        {v.author.name} · {relativeTime(v.createdAt)}
      </span>
      {v.version === shown ? <CheckIcon aria-label="Showing" className="ml-auto size-3.5 text-accent" /> : null}
    </MenuItem>
  ))
}

/** The tasks a page links to; in a panel they open in the whole window, where the board is. */
function TaskChips({ board, tasks, embed }: { board: BoardState; tasks: ReadonlyArray<DocumentTask>; embed: boolean }) {
  return (
    <div aria-label="Linked tasks" role="group" className="mt-5 flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">Tasks</span>
      {tasks.map((t) => {
        const key = parseTaskKey(t.key)
        const task = board.tasks[t.id]
        const look = "inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border border-line bg-raised px-2.5 text-[13px] shadow-card"
        const label = (
          <>
            <span className="font-medium text-ink">{t.key}</span>
            {task ? <span className="truncate text-muted">{task.title}</span> : null}
          </>
        )
        return key ? (
          <Link
            key={t.id}
            to="/$projectKey/$number"
            params={{ projectKey: key.projectKey, number: String(key.number) }}
            {...(embed ? { target: "_top" } : {})}
            aria-label={task ? `${t.key} ${task.title}` : t.key}
            data-task-chip={t.key}
            className={`${look} outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring`}
          >
            {label}
          </Link>
        ) : (
          <span key={t.id} className={look}>
            {label}
          </span>
        )
      })}
    </div>
  )
}

/**
 * The section being read: the one you picked while its heading is on screen; else the last heading
 * above a line near the top of the reader, or the last section once the reader is scrolled to the end
 * (its heading may never reach the top). Updated when a heading crosses that line (an
 * IntersectionObserver) and when a scroll ends, never by polling.
 */
function useCurrentSection(
  scroller: RefObject<HTMLDivElement | null>,
  sections: ReadonlyArray<Section>,
): { readonly current: string | null; readonly choose: (id: string) => void } {
  const [current, setCurrent] = useState<string | null>(sections[0]?.id ?? null)
  const picked = useRef<string | null>(null)
  const ids = sections.map((s) => s.id).join(" ")
  useEffect(() => {
    const root = scroller.current
    if (!root || ids === "") return
    const heads = ids.split(" ").flatMap((id) => {
      const el = root.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`)
      return el ? [el] : []
    })
    const pick = () => {
      const top = root.getBoundingClientRect().top
      const atEnd = root.scrollTop > 0 && root.scrollTop + root.clientHeight >= root.scrollHeight - 2
      let best = heads[0]
      for (const head of heads) if (atEnd || head.getBoundingClientRect().top - top < 140) best = head
      if (best) setCurrent(best.id)
    }
    // While a picked section scrolls into view, crossings don't count; once a scroll ends with its
    // heading off screen (you scrolled away), the position decides again.
    const onCross = () => {
      if (picked.current === null) pick()
    }
    const onScrollEnd = () => {
      const box = root.getBoundingClientRect()
      const chosen = heads.find((h) => h.id === picked.current)?.getBoundingClientRect()
      if (chosen && chosen.top >= box.top - 1 && chosen.top < box.bottom) return
      picked.current = null
      pick()
    }
    const observer = new IntersectionObserver(onCross, { root, rootMargin: "0px 0px -60% 0px", threshold: [0, 1] })
    for (const head of heads) observer.observe(head)
    root.addEventListener("scrollend", onScrollEnd)
    if (picked.current === null) pick()
    return () => {
      observer.disconnect()
      root.removeEventListener("scrollend", onScrollEnd)
    }
  }, [scroller, ids])
  const choose = (id: string) => {
    picked.current = id
    setCurrent(id)
  }
  return { current, choose }
}
