// What the image modal shows: a list of images and which one, or nothing. A plain store like the
// viewer's, so a screenshot in a packet, a card's evidence badge or an image in a page can open it
// from a click handler; one ImageModal (mounted by the app shell) draws it.
import { useSyncExternalStore } from "react"

export interface ModalImage {
  readonly url: string
  /** The caption, else the file name: names the dialog and the image. */
  readonly title: string
  /** The file name, shown beside a caption. */
  readonly name?: string | undefined
}

export interface ImageModalState {
  readonly images: ReadonlyArray<ModalImage>
  readonly index: number
  /** What had the focus (the thumbnail clicked): it gets it back when the modal closes. */
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

/** Opens `images` at `index`. `opener` gets the focus back on close. */
export const openImageModal = (images: ReadonlyArray<ModalImage>, index: number, opener: HTMLElement | null): void =>
  set(images.length === 0 ? null : { images, index: within(index, images.length), opener })

/** ← and →: the previous or next image, stopping at the first and the last. */
export const stepImage = (delta: number): void => {
  if (current) set({ ...current, index: within(current.index + delta, current.images.length) })
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
