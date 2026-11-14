import { Toast, ToastClose, ToastDescription, ToastRegion, ToastTitle, toast } from "@ui-sdk/react/toast"
import { XIcon } from "lucide-react"

export { toast }

/** Mount once near the root; call `toast()` / `toast.error()` from anywhere. */
export function Toaster() {
  return (
    <ToastRegion
      side="bottom"
      align="end"
      className="fixed right-4 bottom-4 z-50 h-(--toast-front-height) w-[360px] data-expanded:h-[calc(var(--toast-stack-height)+(var(--toast-count)-1)*8px)]"
    >
      {() => (
        <Toast className="absolute inset-x-0 bottom-0 flex h-(--toast-height) items-start gap-3 overflow-hidden rounded-lg border border-line bg-raised px-3.5 py-3 text-[13px] text-ink shadow-pop transition-[translate,opacity,height] duration-300 select-none [translate:var(--toast-swipe-x,0px)_calc(var(--toast-index)*-8px+var(--toast-swipe-y,0px))] data-expanded:[translate:var(--toast-swipe-x,0px)_calc(-1*(var(--toast-offset)+var(--toast-index)*8px))] data-starting-style:opacity-0 data-ending-style:opacity-0 data-swiping:transition-none data-[type=error]:border-danger/40 not-data-front:not-data-expanded:h-(--toast-front-height) motion-reduce:transition-opacity">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <ToastTitle className="font-medium" />
            <ToastDescription className="text-muted" />
          </div>
          <ToastClose aria-label="Dismiss" className="rounded p-0.5 text-muted hover:bg-hover hover:text-ink">
            <XIcon className="size-3.5" />
          </ToastClose>
        </Toast>
      )}
    </ToastRegion>
  )
}
