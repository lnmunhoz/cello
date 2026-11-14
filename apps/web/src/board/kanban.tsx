// Adapted from vercel-labs/ui examples/experiments/react/kanban.tsx (undo/limits dropped).
import {
  createChange,
  createRovingFocus,
  createTransfer,
  css,
  definePrimitive,
  selects,
  spatialMove,
  type ChangeDetails,
  type TransferDraft,
  type TransferLists,
  type TransferReason,
} from "@ui-sdk/core"
import { createParts } from "@ui-sdk/react/primitive"

type KanbanOptions = {
  lists?: TransferLists
  defaultLists?: TransferLists
  onListsChange?: (lists: TransferLists, details: ChangeDetails<TransferReason>) => void
  labels?: Record<string, string>
  order?: string[]
}

type KanbanState = {
  lists: TransferLists
  moving: TransferDraft | null
  focused: string | null
}

const kanban = /* @__PURE__ */ definePrimitive({
  name: "kanban",
  options: {
    lists: "value",
    defaultLists: "value",
    onListsChange: "callback",
    labels: "value",
    order: "value",
  },
  state: (options: KanbanOptions): KanbanState => ({
    lists: options.lists ?? options.defaultLists ?? {},
    moving: null,
    focused: null,
  }),
  sync: (options) => (options.lists === undefined ? {} : { lists: options.lists }),
  api: (context) => {
    const { store } = context
    const change = createChange(context)
    const roving = createRovingFocus<KanbanState, { value: string }>(context, {
      slot: "card",
      key: "focused",
      move: spatialMove(),
    })
    const transfer = createTransfer<KanbanState>(context, {
      key: "lists",
      draft: "moving",
      set: (value, details) => change("lists", value, details),
      order: () => context.options().order ?? Object.keys(store.get().lists),
      listLabel: (list) => context.options().labels?.[list],
    })
    return {
      roving,
      transfer,
      cardKeydown(event: KeyboardEvent, el: HTMLElement, key: string) {
        if (!transfer.keydown(event, key)) roving.keydown(event, el)
      },
    }
  },
  slots: (slot) => ({
    root: slot<{}, { lists: TransferLists; movingKey: string | null; pointer: boolean }>({
      state: (state, { api }) => ({
        lists: api.transfer.lists(state),
        movingKey: state.moving?.key ?? null,
        pointer: !!state.moving?.pointer,
      }),
      attrs: () => ({ role: "application", "aria-roledescription": "board" }),
    }),
    column: slot<{ value: string }, { cards: string[] }>({
      props: { value: "string" },
      state: (state, { api, key }) => ({ cards: api.transfer.lists(state)[key] ?? [] }),
      attrs: () => ({ role: "list" }),
      bind: (el, { api, key }) => api.transfer.bindList(el, key),
    }),
    card: slot<{ value: string }, { moving: boolean; dragging: boolean }>({
      props: { value: "string" },
      selects: selects({ focused: ({ key }) => [key, null] }),
      state: (state, { key, api }) => ({
        moving: api.transfer.moving(state, key),
        dragging: api.transfer.dragging(state, key),
      }),
      attrs: (state, part) => ({
        role: "listitem",
        "aria-roledescription": "card",
        tabindex: part.api.roving.tabIndex(state, part),
        "data-moving": part.api.transfer.moving(state, part.key) ? "" : undefined,
        "data-dragging": part.api.transfer.dragging(state, part.key) ? "" : undefined,
        style: css({ "touch-action": "none", "user-select": "none" }),
      }),
      on: {
        keydown: (event, { el, api, key }) => el && api.cardKeydown(event, el, key),
        pointerdown: (event, { api, key }) => api.transfer.pointerdown(event, key),
      },
      bind: (el, part) => {
        const unbindRoving = part.api.roving.bind(el, part)
        const unbindTransfer = part.api.transfer.bindItem(el, part.key)
        return () => {
          unbindRoving?.()
          unbindTransfer()
        }
      },
    }),
  }),
})

const parts = createParts(kanban, { root: "div", column: "div", card: "div" })

export const Kanban = parts.Root
export const KanbanColumn = parts.Column
export const KanbanCard = parts.Card
