import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  message: string
  type: ToastType
}

interface ToastState {
  toasts: Toast[]
  addToast: (message: string, type?: ToastType, durationMs?: number) => number
  removeToast: (id: number) => void
}

// Module-level counter for stable ids (avoids Date.now collisions on bursts).
let counter = 0

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  addToast: (message, type = 'info', durationMs = 4500) => {
    const id = ++counter
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }))
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
  success: (m: string, ms?: number) => useToastStore.getState().addToast(m, 'success', ms),
  error: (m: string, ms?: number) => useToastStore.getState().addToast(m, 'error', ms),
  info: (m: string, ms?: number) => useToastStore.getState().addToast(m, 'info', ms),
}
