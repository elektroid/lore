import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import SheetForm from '@/components/SheetForm'
import type { GetCharacterResponse, PlayerCharacter } from '@/types/character'
import type { SheetValues } from '@/types/sheetTemplate'
import { parseSheetValues } from '@/types/sheetTemplate'
import { api } from '@/api/client'
import { patchCachedItem, patchCachedListItem } from '@/api/cache'
import { useDebouncedSave } from '@/hooks/useDebouncedSave'
import { useSheetTemplate } from '@/hooks/useSheetTemplate'

interface Props {
  characterId: string
  open: boolean
  onClose: () => void
}

function AutoTextarea({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current; if (!el) return
    el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'
  }, [value])
  return (
    <textarea
      ref={ref} rows={3} value={value} placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className="w-full resize-none overflow-hidden rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
    />
  )
}

interface Local { name: string; description: string; personal_story: string }

export default function CharacterEditorModal({ characterId, open, onClose }: Props) {
  const qc = useQueryClient()
  const draft = useDebouncedSave<Partial<Local & { sheet: string }>>()

  const { data: character, isLoading } = useQuery({
    queryKey: ['character', characterId],
    queryFn: () => api.get<GetCharacterResponse>(`/characters/${characterId}`).then(r => r.character),
    enabled: open && !!characterId,
  })

  const [local, setLocal] = useState<Local>({ name: '', description: '', personal_story: '' })
  const [sheetValues, setSheetValues] = useState<SheetValues>({})
  const prevIdRef = useRef('')

  useEffect(() => {
    if (character && character.id !== prevIdRef.current) {
      prevIdRef.current = character.id
      draft.flush()
      setLocal({ name: character.name, description: character.description, personal_story: character.personal_story })
      setSheetValues(parseSheetValues(character.sheet))
    }
  }, [character, draft])

  const { schema, isLoading: schemaLoading } = useSheetTemplate(character?.game_id)

  const save = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<Local & { sheet: string }> }) => {
      const base = qc.getQueryData<PlayerCharacter>(['character', id])
      return api.put<GetCharacterResponse>(`/characters/${id}`, {
        name: base?.name ?? local.name,
        description: base?.description ?? local.description,
        personal_story: base?.personal_story ?? local.personal_story,
        sheet: base?.sheet ?? JSON.stringify(sheetValues),
        ...patch,
      }).then(r => r.character)
    },
    onSuccess: (updated) => {
      qc.setQueryData(['character', updated.id], updated)
      qc.invalidateQueries({ queryKey: ['characters'] })
    },
  })

  function patchCharacter(id: string, patch: Partial<Local & { sheet: string }>) {
    patchCachedItem<PlayerCharacter>(qc, ['character', id], patch)
    patchCachedListItem<PlayerCharacter>(qc, ['characters'], id, patch)
  }

  function handle(field: keyof Local, value: string) {
    const id = characterId
    setLocal(l => ({ ...l, [field]: value }))
    patchCharacter(id, { [field]: value })
    draft.schedule({ [field]: value }, patch => save.mutate({ id, patch }))
  }

  function handleSheetChange(values: SheetValues) {
    const id = characterId
    setSheetValues(values)
    const serialized = JSON.stringify(values)
    patchCharacter(id, { sheet: serialized })
    draft.schedule({ sheet: serialized }, patch => save.mutate({ id, patch }))
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isLoading ? 'Chargement…' : (
              <input
                value={local.name}
                onChange={e => handle('name', e.target.value)}
                className="w-full bg-transparent border-none outline-none text-lg font-semibold placeholder:text-muted-foreground/50"
                placeholder="Nom du personnage"
              />
            )}
          </DialogTitle>
        </DialogHeader>

        {!isLoading && character && (
          <div className="space-y-4">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Description</p>
              <AutoTextarea value={local.description} onChange={v => handle('description', v)} placeholder="Apparence, personnalité…" />
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Historique</p>
              <AutoTextarea value={local.personal_story} onChange={v => handle('personal_story', v)} placeholder="D'où il/elle vient, ce qui l'a mené·e ici…" />
            </div>

            <div className="space-y-1 pt-2 border-t">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide pt-3">
                Fiche — {character.game_name || 'jeu non défini'}
              </p>
              {schemaLoading ? (
                <p className="text-xs text-muted-foreground">Chargement…</p>
              ) : schema ? (
                <SheetForm schema={schema} values={sheetValues} scope="pc" onChange={handleSheetChange} />
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  Pas encore de fiche pour ce système — un administrateur peut en associer une depuis la page Jeux.
                </p>
              )}
            </div>

            {save.isPending && <p className="text-xs text-muted-foreground text-right">Sauvegarde…</p>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
