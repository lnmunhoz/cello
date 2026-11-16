// Settings' Waking section (CEL-92): whether Cello wakes a project's agent sessions by itself when you
// act on a task they claimed and their process is gone (off by default), the cap, what a woken run may
// do, and a warning when woken runs would bill an API key.
import { useAtomSet, useAtomValue } from "@effect/atom-react"
import * as AsyncResult from "effect/reactivity/AsyncResult"
import { useState } from "react"
import { Input } from "../components/ui/Input.tsx"
import { Switch } from "../components/ui/Switch.tsx"
import { commands, wakeSettingsFamily } from "../lib/cello.ts"
import { SAVES_ON_BLUR } from "../lib/editing.ts"

export function WakeSettings({ projectKey }: { projectKey: string }) {
  const result = useAtomValue(wakeSettingsFamily(projectKey))
  const save = useAtomSet(commands.setWakeSettings)
  const [draft, setDraft] = useState<string | null>(null)
  if (!AsyncResult.isSuccess(result)) return <p className="text-[13px] text-muted">Loading…</p>
  const settings = result.value
  const saveCap = () => {
    const cap = Number(draft)
    if (draft !== null && Number.isInteger(cap) && cap >= 1 && cap <= 20 && cap !== settings.capPerHour) save({ projectKey, capPerHour: cap })
    setDraft(null)
  }
  return (
    <div className="flex flex-col gap-3" data-wake-settings>
      <ul className="divide-y divide-line rounded-lg border border-line">
        <li className="px-3 py-2.5">
          <label className="flex items-center justify-between gap-3 text-[13px]">
            <span className="font-medium">Wake agent sessions when you comment</span>
            <Switch checked={settings.enabled} onCheckedChange={(enabled) => save({ projectKey, enabled })} />
          </label>
          <p className="mt-1 text-[13px] text-muted">
            When you comment on, answer or send back a task an agent claimed, and its Claude process is gone, Cello continues that same
            conversation in the background, in the repo folder. It reads your comment, answers on the card, and exits.
          </p>
        </li>
        <li className="flex items-center gap-3 px-3 py-2">
          <span className="flex-1 text-[13px] text-muted">Wakes per task per hour, at most</span>
          <div className="w-16">
            <Input
              size="sm"
              aria-label="Wakes per task per hour"
              inputMode="numeric"
              {...SAVES_ON_BLUR}
              value={draft ?? String(settings.capPerHour)}
              onFocus={() => setDraft(String(settings.capPerHour))}
              onChange={(e) => setDraft(e.currentTarget.value)}
              onBlur={saveCap}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur()
                if (e.key === "Escape") {
                  setDraft(null)
                  e.currentTarget.blur()
                }
              }}
            />
          </div>
        </li>
        <li className="px-3 py-2.5 text-[13px] text-muted">
          A woken run is unattended. It uses the permission mode the session last had (Cello's hooks record it), never bypassPermissions:
          what that mode allows, it does without asking; anything else is refused and it says so on the card. Past the limit your comment
          waits in the inbox, as it does when waking is off.
        </li>
        {settings.agents.map((agent) => (
          <li key={agent.kind} className="px-3 py-2 text-[13px] text-muted" data-wake-agent={agent.kind}>
            {agent.name}: {agent.installed ? "installed" : "not found on the Cello server's PATH, so its sessions can't be woken"}
          </li>
        ))}
      </ul>
      {settings.apiKeySet ? (
        <p role="alert" className="text-[13px] text-danger" data-wake-api-key>
          ANTHROPIC_API_KEY is set in the Cello server's environment, so woken runs are billed to that API key, not your Claude subscription.
        </p>
      ) : null}
    </div>
  )
}
