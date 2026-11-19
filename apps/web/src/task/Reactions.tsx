import type { BoardState } from "@cello/client/sync/applyEvents"
import type { Comment, Reaction } from "@cello/contract/entities"
import { groupReactions, pickMatches, QUICK_REACTIONS, REACTION_PICKS } from "@cello/domain/reaction"
import { andList } from "@cello/domain/words"
import { useAtomSet } from "@effect/atom-react"
import { SmilePlusIcon } from "lucide-react"
import { useState } from "react"
import { SearchInput } from "../components/ui/Input.tsx"
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/Popover.tsx"
import { EmojiPick, ReactionChip } from "../components/ui/Reaction.tsx"
import { commands } from "../lib/cello.ts"
import { whoOf } from "../presence/model.ts"

/** The board's viewer is the human: a reaction with no session is theirs. */
const isMine = (r: Reaction) => r.sessionId === null

/**
 * A comment's footer (CEL-77): its reactions as chips (emoji and count, pressed when one is yours; a click
 * toggles yours) and a button that opens the picker: five quick picks, then a short curated set to search.
 * Lucas's reaction to an agent's comment reaches that agent's session.
 */
export function Reactions({ board, comment }: { board: BoardState; comment: Comment }) {
  const react = useAtomSet(commands.reactToComment)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const chips = groupReactions(comment.reactions ?? [], isMine)
  const mine = new Set(chips.filter((c) => c.mine).map((c) => c.emoji))
  const toggle = (emoji: string) => react({ commentId: comment.id, emoji, on: !mine.has(emoji) })
  const choose = (emoji: string) => {
    toggle(emoji)
    setOpen(false)
    setQuery("")
  }
  // The grid holds the rest of the set; a search looks through all of it, the quick picks included.
  const picks = query.trim() === "" ? REACTION_PICKS.slice(QUICK_REACTIONS.length) : REACTION_PICKS.filter((p) => pickMatches(p, query))

  return (
    <div role="group" aria-label="Reactions" className="flex flex-wrap items-center gap-1.5" data-reactions>
      {chips.map((chip) => {
        const names = andList(chip.reactions.map((r) => (isMine(r) ? "You" : whoOf(board, r.actorId, r.sessionId, r.agentId).name)))
        return (
          <ReactionChip
            key={chip.emoji}
            emoji={chip.emoji}
            count={chip.count}
            mine={chip.mine}
            aria-label={`${chip.emoji} ${chip.count}: ${names}${chip.mine ? ". Click to take yours back" : ". Click to react too"}`}
            title={`${names} reacted with ${chip.emoji}`}
            onClick={() => toggle(chip.emoji)}
          />
        )
      })}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger variant="reaction" aria-label="Add a reaction" title="Add a reaction">
          <SmilePlusIcon aria-hidden className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent side="top">
          <div className="flex w-72 max-w-[calc(100vw-2rem)] flex-col gap-2" aria-label="Pick a reaction" role="group">
            <div className="flex items-center justify-between gap-1" role="group" aria-label="Quick reactions">
              {QUICK_REACTIONS.map((emoji) => (
                <EmojiPick key={emoji} size="quick" aria-label={`React ${emoji}`} title={REACTION_PICKS.find((p) => p.emoji === emoji)?.name} aria-pressed={mine.has(emoji)} onClick={() => choose(emoji)}>
                  {emoji}
                </EmojiPick>
              ))}
            </div>
            <SearchInput size="sm" aria-label="Search emoji" placeholder="Search emoji" value={query} onChange={(e) => setQuery(e.currentTarget.value)} />
            {picks.length > 0 ? (
              <div className="grid grid-cols-8 gap-0.5" role="group" aria-label="More reactions">
                {picks.map((p) => (
                  <EmojiPick key={p.emoji} aria-label={`React ${p.emoji}`} title={p.name} aria-pressed={mine.has(p.emoji)} onClick={() => choose(p.emoji)}>
                    {p.emoji}
                  </EmojiPick>
                ))}
              </div>
            ) : (
              <p className="px-1 py-2 text-xs text-faint">No emoji named “{query.trim()}”.</p>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
