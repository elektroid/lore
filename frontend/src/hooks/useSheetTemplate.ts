import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import type { Game } from '@/types/game'
import type { SheetSchema, SheetTemplate } from '@/types/sheetTemplate'
import { parseSheetSchema } from '@/types/sheetTemplate'

/** Resolves the sheet_template a game currently points at, live — never cached
 * on the character/NPC itself. Returns null while loading or when the game
 * has no template attached. */
export function useSheetTemplate(gameId: string | undefined): { schema: SheetSchema | null; isLoading: boolean } {
  const { data: game, isLoading: gameLoading } = useQuery({
    queryKey: ['game', gameId],
    queryFn: () => api.get<Game>(`/games/${gameId}`),
    enabled: !!gameId,
  })

  const templateId = game?.sheet_template_id ?? null

  const { data: tmpl, isLoading: tmplLoading } = useQuery({
    queryKey: ['sheet-template', templateId],
    queryFn: () => api.get<SheetTemplate>(`/sheet-templates/${templateId}`),
    enabled: !!templateId,
  })

  if (!gameId) return { schema: null, isLoading: false }
  if (gameLoading || (templateId && tmplLoading)) return { schema: null, isLoading: true }
  if (!templateId) return { schema: null, isLoading: false }

  return { schema: parseSheetSchema(tmpl?.schema), isLoading: false }
}
