import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'daylight' | 'night' | 'cyberpunk'

interface UIState {
  activeCampaignId: string | null
  activeScenarioId: string | null
  theme: Theme
  setActiveCampaign: (id: string | null) => void
  setActiveScenario: (id: string | null) => void
  setTheme: (theme: Theme) => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      activeCampaignId: null,
      activeScenarioId: null,
      theme: 'night',
      setActiveCampaign: (id) => set({ activeCampaignId: id }),
      setActiveScenario: (id) => set({ activeScenarioId: id }),
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'lore-ui', partialize: (s: UIState) => ({ theme: s.theme }) },
  ),
)
