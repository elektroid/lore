import { useState } from 'react'
import { Plus, Trash2, Search, ShieldAlert } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { SynopsisFaction } from '@/types/synopsis'
import type { CampaignFaction } from '@/types/entities'
import { api } from '@/api/client'

interface Props {
  scenarioId: string
  campaignId: string
}

function FactionPickerDialog({
  campaignId,
  open,
  onClose,
  onPick,
}: {
  campaignId: string
  open: boolean
  onClose: () => void
  onPick: (f: CampaignFaction) => void
}) {
  const [search, setSearch] = useState('')

  const { data: campaignFactions = [] } = useQuery({
    queryKey: ['campaign-factions', campaignId],
    queryFn: () => api.get<CampaignFaction[]>(`/campaigns/${campaignId}/factions`),
    enabled: open,
  })

  const filtered = campaignFactions.filter(f =>
    f.name.toLowerCase().includes(search.toLowerCase()) ||
    f.type.toLowerCase().includes(search.toLowerCase()),
  )

  function handleClose() { setSearch(''); onClose() }

  return (
    <Dialog open={open} onOpenChange={o => !o && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ajouter une faction</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…" className="h-8 pl-8 text-sm" autoFocus />
          </div>
          {campaignFactions.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">Aucune faction dans la campagne — créez-en une dans l'onglet Entités.</p>
          ) : filtered.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">Aucun résultat.</p>
          ) : (
            <ul className="space-y-1 max-h-60 overflow-y-auto">
              {filtered.map(f => (
                <li key={f.id}>
                  <button
                    onClick={() => { onPick(f); handleClose() }}
                    className="w-full text-left rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    <p className="font-medium">{f.name}</p>
                    {f.type && <p className="text-xs text-muted-foreground">{f.type}</p>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function FactionWidget({ scenarioId, campaignId }: Props) {
  const qc = useQueryClient()
  const [pickerOpen, setPickerOpen] = useState(false)

  const { data: factions = [] } = useQuery({
    queryKey: ['synopsis-factions', scenarioId],
    queryFn: () => api.get<SynopsisFaction[]>(`/scenarios/${scenarioId}/synopsis/factions`),
  })

  const addFaction = useMutation({
    mutationFn: (factionId: string) =>
      api.post<SynopsisFaction[]>(`/scenarios/${scenarioId}/synopsis/factions`, { faction_id: factionId }),
    onSuccess: (data) => {
      qc.setQueryData(['synopsis-factions', scenarioId], data)
      setPickerOpen(false)
    },
  })

  const removeFaction = useMutation({
    mutationFn: (factionId: string) =>
      api.delete(`/scenarios/${scenarioId}/synopsis/factions/${factionId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['synopsis-factions', scenarioId] }),
  })

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Factions impliquées</h3>
        <Button size="sm" variant="ghost" onClick={() => setPickerOpen(true)} className="h-7 px-2 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1" /> Ajouter
        </Button>
      </div>

      {factions.length === 0 && (
        <p className="text-xs text-muted-foreground">Aucune faction. Ajoutez-en une.</p>
      )}

      <ul className="space-y-1">
        {factions.map(f => (
          <li key={f.id} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2">
            <ShieldAlert className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium flex-1">{f.name}</span>
            {f.type && <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{f.type}</span>}
            <Button
              size="sm" variant="ghost"
              className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
              onClick={() => removeFaction.mutate(f.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </li>
        ))}
      </ul>

      <FactionPickerDialog
        campaignId={campaignId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={f => addFaction.mutate(f.id)}
      />
    </section>
  )
}
