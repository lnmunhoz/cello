// What the image modal shows: a list of images and diagrams and which one, or nothing. A plain store
// like the viewer's, so a screenshot in a packet, a card's evidence badge, an image or a diagram in a
// page can open it from a click handler; one ImageModal (mounted by the app shell) draws it.
import { useSyncExternalStore } from "react"

export interface ModalImage {
  readonly kind?: "image"
  readonly url: string
  /** The caption, else the file name: names the dialog and the image. */
  readonly title: string
  /** The file name, shown beside a caption. */
  readonly name?: string | undefined
}

/** A Mermaid diagram: the modal draws it again from its source, as vector, in the current theme. */
export interface ModalDiagram {
  readonly kind: "diagram"
  readonly source: string
  /** "Diagram: " and its first label: names the dialog. */
  readonly title: string
}

export type ModalItem = ModalImage | ModalDiagram

export interface ImageModalState {
  readonly items: ReadonlyArray<ModalItem>
  readonly index: number
  /** What had the focus (the thumbnail or diagram clicked): it gets it back when the modal closes. */
  readonly opener: HTMLElement | null
}

let current: ImageModalState | null = null
let afterClose: (() => void) | null = null
const listeners = new Set<() => void>()

const set = (state: ImageModalState | null) => {
  current = state
  for (const listener of listeners) listener()
}

const within = (index: number, count: number) => Math.min(count - 1, Math.max(0, index))

export const imageModal = (): ImageModalState | null => current

/** Opens `items` at `index`. `opener` gets the focus back on close. */
export const openImageModal = (items: ReadonlyArray<ModalItem>, index: number, opener: HTMLElement | null): void => {
  if (items.length === 0) return
  // A close still finishing doesn't get to run its follow-up over the modal opened since.
  afterClose = null
  set({ items, index: within(index, items.length), opener })
}

/** ← and →: the previous or next item, stopping at the first and the last. */
export const stepImage = (delta: number): void => {
  if (current) set({ ...current, index: within(current.index + delta, current.items.length) })
}

/**
 * Closes the modal. `then` runs once it has finished closing (`closedImageModal`): the page is no
 * longer inert and the opener has the focus back, so what `then` opens (the viewer) starts from there.
 */
export const closeImageModal = (then?: () => void): void => {
  afterClose = then ?? null
  set(null)
}

/** The modal finished closing: runs what `closeImageModal` was asked to do next. */
export const closedImageModal = (): void => {
  const then = afterClose
  afterClose = null
  then?.()
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export const useImageModal = (): ImageModalState | null => useSyncExternalStore(subscribe, imageModal)
