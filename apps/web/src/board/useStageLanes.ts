// Display → "Group In Progress by stage" (CEL-35): off unless turned on, remembered on this device like
// "Show agent cursors". The board splits In Progress into lanes; the list shows a stage column there.
import { useStored, writeStored } from "../lib/storage.ts"

const KEY = "cello:stage-lanes"

export const useStageLanes = (): boolean => useStored(KEY) === "on"

export const showStageLanes = (on: boolean): void => writeStored(KEY, on ? "on" : "off")
