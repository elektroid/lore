import { BookOpen, Swords, Users, Shield } from 'lucide-react'
import type { AppMode } from '@/stores/mode'

export interface ModeInfo {
  id: AppMode
  label: string
  description: string
  icon: typeof BookOpen
  superuserOnly?: boolean
}

// Shared between ModePicker (the "how do you want to act?" screen) and
// AppShell (the top-bar badge) so the two never drift apart.
export const MODES: ModeInfo[] = [
  {
    id: 'author',
    label: 'Auteur',
    description: "Écrivez une campagne : cast, lieux, scénarios, accès.",
    icon: BookOpen,
  },
  {
    id: 'gamemaster',
    label: 'Meneur de jeu',
    description: "Lancez une table : console de jeu, projection, dés.",
    icon: Swords,
  },
  {
    id: 'player',
    label: 'Joueur',
    description: "Vos tables, vos personnages, vos notes.",
    icon: Users,
  },
  {
    id: 'admin',
    label: 'Administrateur',
    description: "Jeux, LLM, comptes, journal — la configuration de l'instance.",
    icon: Shield,
    superuserOnly: true,
  },
]

export function modeInfo(id: AppMode | null | undefined): ModeInfo | undefined {
  return MODES.find(m => m.id === id)
}
