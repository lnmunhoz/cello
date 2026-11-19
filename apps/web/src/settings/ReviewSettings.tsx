// Settings → Review (CEL-191): whether Approve and Send back wait a few seconds on the Review page, so they can
// be undone before the agent hears of them, and for how long. Kept on this device (review/undoWindow.ts).
import { SegmentedControl, SegmentedControlItem } from "../components/ui/SegmentedControl.tsx"
import { Switch } from "../components/ui/Switch.tsx"
import { writeStored } from "../lib/storage.ts"
import { UNDO_CHOICES, UNDO_WINDOW_KEY, undoStored, useUndoWindow } from "../review/undoWindow.ts"

export function ReviewSettings() {
  const undo = useUndoWindow()
  return (
    <ul className="divide-y divide-line rounded-lg border border-line" data-review-settings>
      <li className="px-3 py-2.5">
        <label className="flex items-center justify-between gap-3 text-[13px]">
          <span className="font-medium">Undo a decision before it is sent</span>
          <Switch checked={undo.on} onCheckedChange={(on) => writeStored(UNDO_WINDOW_KEY, undoStored({ ...undo, on }))} />
        </label>
        <p className="mt-1 text-[13px] text-muted">
          {undo.on
            ? `After Approve or Send back on the Review page, the row says Undo for ${undo.seconds} seconds and nothing is sent until they have passed. Leaving the page sends it at once.`
            : "Approve and Send back are sent at once."}
        </p>
      </li>
      {undo.on ? (
        <li className="flex items-center justify-between gap-3 px-3 py-2.5 text-[13px]">
          <span className="font-medium">How long</span>
          <SegmentedControl
            aria-label="Undo window"
            value={String(undo.seconds)}
            onValueChange={(value) => value && writeStored(UNDO_WINDOW_KEY, undoStored({ on: true, seconds: Number(value) }))}
          >
            {UNDO_CHOICES.map((seconds) => (
              <SegmentedControlItem key={seconds} value={String(seconds)}>
                {seconds} s
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
        </li>
      ) : null}
    </ul>
  )
}
