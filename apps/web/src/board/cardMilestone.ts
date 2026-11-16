// Display → "Milestone on cards" (CEL-113): a card shows its milestone as a chip next to its labels,
// unless turned off on this device.
import { displaySwitch } from "../lib/displaySwitch.ts"

const chip = displaySwitch("cello:card-milestone", true)

export const showCardMilestone = chip.set
export const useCardMilestone = chip.use
