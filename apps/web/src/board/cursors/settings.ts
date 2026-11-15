// Display → "Show agent cursors": on unless turned off on this device.
import { displaySwitch } from "../../lib/displaySwitch.ts"

const cursors = displaySwitch("cello:agent-cursors", true)

export const agentCursorsShown = cursors.get
export const showAgentCursors = cursors.set
export const useAgentCursorsShown = cursors.use
