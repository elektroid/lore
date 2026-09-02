import { create } from 'zustand'

export interface Toast {
  id: string
  variant: 'error' | 'success'
  message: string
}

interface ToastState {
  toasts: Toast[]
  dismiss: (id: string) => void
}

const DURATION_MS: Record<Toast['variant'], number> = {
  error: 6000,
  success: 3000,
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

function push(variant: Toast['variant'], message: string) {
  const id = crypto.randomUUID()
  useToastStore.setState((s) => ({ toasts: [...s.toasts, { id, variant, message }] }))
  setTimeout(() => useToastStore.getState().dismiss(id), DURATION_MS[variant])
}

// Imperative API — usable outside React (e.g. the query client's global
// mutation error handler) as well as inside components.
export const toast = {
  error: (message: string) => push('error', message),
  success: (message: string) => push('success', message),
}
