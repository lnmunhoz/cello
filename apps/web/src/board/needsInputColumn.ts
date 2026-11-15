// Display → "Needs input column" (CEL-47): off unless turned on on this device (Lucas, Nov 15). While
// it's off, tasks waiting on his answers show in In Progress with a Needs input badge, on the board and
// in the list; the sidebar's Needs input item is where he finds them.
import { displaySwitch } from "../lib/displaySwitch.ts"

const column = displaySwitch("cello:needs-input-column", false)

export const showNeedsInputColumn = column.set
export const useNeedsInputColumn = column.use
