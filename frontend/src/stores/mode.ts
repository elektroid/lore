import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// The four ways of using the app a logged-in account can pick between —
// see docs/users.md. Not a backend role: only 'admin' is actually gated
// (requires role === 'superuser'); author/gamemaster/player are the same
// account choosing which of its own capabilities to act through right now.
export type AppMode = 'author' | 'gamemaster' | 'player' | 'admin'

interface ModeState {
  mode: AppMode | null
  setMode: (mode: AppMode | null) => void
}

export const useModeStore = create<ModeState>()(
  persist(
    (set) => ({
      mode: null,
      setMode: (mode) => set({ mode }),
    }),
    { name: 'lore-mode' },
  ),
)
