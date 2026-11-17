// Settings → Updates (CEL-140), in Cello.app only: the release channel, Check now, downloading updates
// automatically, and when it last checked. The app's main process keeps these (userData/updates.json).
import { CHANNEL_NAMES, CHANNELS, updateLine, type Channel, type UpdateState } from "@cello/shared/updates"
import { Link } from "@tanstack/react-router"
import { Button } from "../components/ui/Button.tsx"
import { SegmentedControl, SegmentedControlItem } from "../components/ui/SegmentedControl.tsx"
import { Switch } from "../components/ui/Switch.tsx"
import { relativeTime } from "../lib/format.ts"
import { updateCommand } from "../updates/updates.ts"

const CHANNEL_HINTS: Readonly<Record<Channel, string>> = {
  stable: "Releases only.",
  preview: "Previews of the next version too (betas), and every stable release that's newer than them.",
}

export function UpdateSettings({ state }: { state: UpdateState }) {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line" data-update-settings>
      <li className="flex flex-col gap-1.5 px-3 py-2.5">
        <div className="flex items-center gap-3">
          <span className="flex-1 text-[13px] font-medium">Channel</span>
          <SegmentedControl
            aria-label="Update channel"
            value={state.channel}
            onValueChange={(value) => (value === "stable" || value === "preview") && updateCommand({ kind: "channel", channel: value })}
          >
            {CHANNELS.map((channel) => (
              <SegmentedControlItem key={channel} value={channel}>
                {CHANNEL_NAMES[channel]}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </div>
        <p className="text-[13px] text-muted">{CHANNEL_HINTS[state.channel]}</p>
      </li>
      <li className="px-3 py-2.5">
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span className="font-medium">Download updates automatically</span>
          <Switch checked={state.autoDownload} onCheckedChange={(on) => updateCommand({ kind: "auto-download", on })} />
        </label>
        <p className="mt-1 text-[13px] text-muted">
          A new version's disk image downloads to your Downloads folder in the background, so Download opens it at once. Installing stays yours:
          drag Cello onto Applications.
        </p>
      </li>
      <li className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
        <div className="min-w-0 flex-1">
          <p className={state.latest ? "font-medium text-accent" : "text-ink"} data-update-line>
            {updateLine(state)}
          </p>
          <p className="text-muted" data-update-checked>
            {state.checking ? "Checking…" : state.checkedAt !== null ? `Last checked ${relativeTime(state.checkedAt)}` : "Not checked yet"}
            {state.error ? ` · ${state.error}` : ""}
          </p>
        </div>
        <Button size="sm" disabled={state.checking} onClick={() => updateCommand({ kind: "check" })}>
          Check now
        </Button>
        <Link to="/releases" className="shrink-0 font-medium text-ink hover:underline">
          See all releases →
        </Link>
      </li>
    </ul>
  )
}
