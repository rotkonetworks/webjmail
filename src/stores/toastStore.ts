import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info'

// An inline button on a toast. The Toaster dismisses the toast after onClick.
export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: number
  message: string
  type: ToastType
  actions?: ToastAction[]
}

interface ToastState {
  toasts: Toast[]
  addToast: (
    message: string,
    type?: ToastType,
    durationMs?: number,
    actions?: ToastAction[]
  ) => number
  removeToast: (id: number) => void
}

// Module-level counter for stable ids (avoids Date.now collisions on bursts).
let counter = 0

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  addToast: (message, type = 'info', durationMs = 4500, actions) => {
    const id = ++counter
    set((s) => ({ toasts: [...s.toasts, { id, message, type, actions }] }))
    if (durationMs > 0) {
      setTimeout(() => get().removeToast(id), durationMs)
    }
    return id
  },
  removeToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

// Convenience helpers usable outside React (stores, api client, etc.).
export const toast = {
  success: (m: string, ms?: number, actions?: ToastAction[]) =>
    useToastStore.getState().addToast(m, 'success', ms, actions),
  error: (m: string, ms?: number, actions?: ToastAction[]) =>
    useToastStore.getState().addToast(m, 'error', ms, actions),
  info: (m: string, ms?: number, actions?: ToastAction[]) =>
    useToastStore.getState().addToast(m, 'info', ms, actions),
}
