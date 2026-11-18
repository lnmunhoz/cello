import { durationWords, groupStartsOpen, type StoryItem, storyKey, storySteps, workedWords } from "@cello/client/sync/agentLog"
import { CheckIcon, XIcon } from "lucide-react"
import { useState } from "react"
import type { AgentRow } from "./layout.ts"
import { Step, ToggleRow, useFades } from "./LogStep.tsx"

/** What every row of the story needs: whose log, whether the agent is working, which steps just arrived, and what's been shown. */
export interface StoryContext {
  readonly row: AgentRow
  readonly working: boolean
  readonly arrived: ReadonlyArray<string>
  readonly shown: Set<string>
  /** The ids of the calls the human opened. */
  readonly opened: Set<string>
}

/**
 * The Story view's rows (CEL-170): prompts and messages as they are, a run of calls as one row ("Ran 9
 * commands, read 3 files") a click opens, the call running now as its own live row, and a turn that ended
 * folded under "Worked for 4 min 12 s". Whether a group or a turn is open is each row's own state, kept
 * while the log updates under it.
 */
export function StoryList({ items, context }: { readonly items: ReadonlyArray<StoryItem>; readonly context: StoryContext }) {
  return <>{items.map((item) => <StoryRow key={storyKey(item)} item={item} context={context} />)}</>
}

function StoryRow({ item, context }: { readonly item: StoryItem; readonly context: StoryContext }) {
  if (item._tag === "group") return <Group item={item} context={context} />
  if (item._tag === "turn") return <Turn item={item} context={context} />
  const { row, working, arrived, shown, opened } = context
  return <Step step={item.step} row={row} working={working} arrived={arrived.includes(item.step.id)} shown={shown} opened={opened} live={item._tag === "live"} />
}

function Group({ item, context }: { readonly item: Extract<StoryItem, { _tag: "group" }>; readonly context: StoryContext }) {
  const { row, working, arrived, shown, opened } = context
  // A group formed around a call the human had opened (it was a row of its own until a second call came) starts open.
  const [open, setOpen] = useState(() => groupStartsOpen(item.steps, opened))
  const fades = useFades(item.id, item.steps.some((step) => arrived.includes(step.id)), shown)
  const failed = item.failed > 0
  return (
    <li data-log-group={item.id} data-log-status={failed ? "error" : "ok"} className={fades ? "log-arrive" : ""}>
      <ToggleRow
        open={open}
        onToggle={() => setOpen(!open)}
        mark={failed ? <XIcon aria-label="Failed" className="size-3.5 text-danger" /> : <CheckIcon aria-label="Succeeded" className="size-3.5 text-answered" />}
        label={
          <span className="truncate text-ink">
            <span data-log-summary>{item.summary}</span>
            {failed ? (
              <span data-log-failed className="text-danger">
                {" "}
                · {item.failed} failed
              </span>
            ) : null}
          </span>
        }
        after={durationWords(item.durationMs)}
      />
      {open ? (
        <ol aria-label="Calls" className="ml-[22px] flex flex-col gap-px">
          {item.steps.map((step) => (
            <Step key={step.id} step={step} row={row} working={working} arrived={arrived.includes(step.id)} shown={shown} opened={opened} />
          ))}
        </ol>
      ) : null}
    </li>
  )
}

function Turn({ item, context }: { readonly item: Extract<StoryItem, { _tag: "turn" }>; readonly context: StoryContext }) {
  const [open, setOpen] = useState(false)
  const fades = useFades(item.id, storySteps(item).some((step) => context.arrived.includes(step.id)), context.shown)
  return (
    <li data-log-turn={item.id} className={fades ? "log-arrive" : ""}>
      <ToggleRow
        open={open}
        onToggle={() => setOpen(!open)}
        mark={<span aria-hidden className="size-3.5" />}
        label={<span className="truncate text-xs text-muted">{workedWords(item.durationMs)}</span>}
        after=""
      />
      {open ? (
        <ol aria-label="Work" className="ml-[22px] flex flex-col gap-px border-l border-line">
          <StoryList items={item.items} context={context} />
        </ol>
      ) : null}
    </li>
  )
}
