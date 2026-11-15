// Display → "Group In Progress by stage" (CEL-35): off unless turned on, remembered on this device like
// the other Display switches. The board splits In Progress into lanes; the list shows a stage column there.
import { displaySwitch } from "../lib/displaySwitch.ts"

const lanes = displaySwitch("cello:stage-lanes", false)

export const useStageLanes = lanes.use

export const showStageLanes = lanes.set
