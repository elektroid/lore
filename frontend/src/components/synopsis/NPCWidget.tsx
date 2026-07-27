import { useEffect, useRef, useState } from 'react'
import { Plus, Trash2, Sparkles, Search, UserRound } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import StatusBadge from './StatusBadge'
import type { SynopsisNPC } from '@/types/synopsis'
import type { CampaignNPC } from '@/types/entities'
import { api } from '@/api/client'
import { patchCachedListItem } from '@/api/cache'
import { useDebouncedSave } from '@/hooks/useDebouncedSave'
import LLMSuggestionReview from '@/components/LLMSuggestionReview'
import { NPC_SUGGESTION_FIELDS } from '@/components/NPCEditorModal'

interface Props {
  scenarioId: string
  campaignId: string
}

// ── NPC picker dialog ─────────────────────────────────────────────────────

function NPCPickerDialog({
  campaignId,
  open,
  onClose,
  onPick,
}: {
  campaignId: string
  open: boolean
  onClose: () => void
  onPick: (npc: CampaignNPC) => void
}) {
  const [search, setSearch] = useState('')
  const [newName, setNewName] = useState('')
  const [mode, setMode] = useState<'pick' | 'create'>('pick')
  const qc = useQueryClient()

  const { data: campaignNPCs = [] } = useQuery({
    queryKey: ['campaign-npcs', campaignId],
    queryFn: () => api.get<CampaignNPC[]>(`/campaigns/${campaignId}/npcs`),
    enabled: open,
  })

  const create = useMutation({
    mutationFn: (name: string) =>
      api.post<CampaignNPC>(`/campaigns/${campaignId}/npcs`, { name, role: '', description: '', quote: '' }),
    onSuccess: (npc) => {
      qc.invalidateQueries({ queryKey: ['campaign-npcs', campaignId] })
      onPick(npc)
    },
  })

  const filtered = campaignNPCs.filter(n =>
    n.name.toLowerCase().includes(search.toLowerCase()) ||
    n.role.toLowerCase().includes(search.toLowerCase()),
  )

  function handleClose() {
    setSearch('')
    setNewName('')
    setMode('pick')
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && handleClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Ajouter un PNJ</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 border-b pb-3">
          <Button size="sm" variant={mode === 'pick' ? 'default' : 'ghost'} className="h-7 text-xs" onClick={() => setMode('pick')}>
            Depuis la campagne
          </Button>
          <Button size="sm" variant={mode === 'create' ? 'default' : 'ghost'} className="h-7 text-xs" onClick={() => setMode('create')}>
            Nouveau PNJ
          </Button>
        </div>

        {mode === 'pick' && (
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Rechercher…" className="h-8 pl-8 text-sm" autoFocus />
            </div>
            {campaignNPCs.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">Aucun PNJ dans la campagne — créez-en un ci-dessus.</p>
            ) : filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">Aucun résultat.</p>
            ) : (
              <ul className="space-y-1 max-h-60 overflow-y-auto">
                {filtered.map(npc => (
                  <li key={npc.id}>
                    <button
                      onClick={() => { onPick(npc); handleClose() }}
                      className="w-full text-left rounded-md px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground transition-colors"
                    >
                      <p className="font-medium">{npc.name}</p>
                      {npc.role && <p className="text-xs text-muted-foreground">{npc.role}</p>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {mode === 'create' && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Le PNJ sera créé dans la campagne et ajouté au synopsis.</p>
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              placeholder="Nom du PNJ"
              className="h-8 text-sm"
              autoFocus
              onKeyDown={e => {
                if (e.key === 'Enter' && newName.trim() && !create.isPending) create.mutate(newName.trim())
              }}
            />
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="ghost" className="h-7" onClick={handleClose}>Annuler</Button>
              <Button size="sm" className="h-7" disabled={!newName.trim() || create.isPending} onClick={() => create.mutate(newName.trim())}>
                {create.isPending ? 'Création…' : 'Créer et ajouter'}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── NPC row ───────────────────────────────────────────────────────────────

function NPCRow({ npc, scenarioId }: { npc: SynopsisNPC; scenarioId: string }) {
  const qc = useQueryClient()
  const locked = npc.status === 'confirmed'

  const [local, setLocal] = useState({
    name: npc.name, role: npc.role, description: npc.description, quote: npc.quote, motivation: npc.motivation ?? '',
  })
  const prevRef = useRef({ name: npc.name, role: npc.role, description: npc.description, quote: npc.quote, motivation: npc.motivation ?? '' })
  // localRef mirrors local state without closure staleness — timer always reads latest values
  const localRef = useRef({ name: npc.name, role: npc.role, description: npc.description, quote: npc.quote, motivation: npc.motivation ?? '' })
  const draft = useDebouncedSave<typeof local>()
  const descRef = useRef<HTMLTextAreaElement>(null)
  const [suggestion, setSuggestion] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    const changed: Partial<typeof local> = {}
    if (npc.name !== prevRef.current.name) changed.name = npc.name
    if (npc.role !== prevRef.current.role) changed.role = npc.role
    if (npc.description !== prevRef.current.description) changed.description = npc.description
    if (npc.quote !== prevRef.current.quote) changed.quote = npc.quote
    const mot = npc.motivation ?? ''
    if (mot !== prevRef.current.motivation) changed.motivation = mot
    if (Object.keys(changed).length > 0) {
      prevRef.current = { ...prevRef.current, ...changed }
      localRef.current = { ...localRef.current, ...changed }
      setLocal(l => ({ ...l, ...changed }))
    }
  }, [npc.name, npc.role, npc.description, npc.quote])

  useEffect(() => {
    const el = descRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [local.description])

  const save = useMutation({
    mutationFn: (data: typeof local) =>
      api.put<CampaignNPC>(`/campaigns/${npc.campaign_id}/npcs/${npc.id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['synopsis-npcs', scenarioId] })
      qc.invalidateQueries({ queryKey: ['campaign-npcs', npc.campaign_id] })
    },
  })

  const updateStatus = useMutation({
    mutationFn: (status: string) =>
      api.put<SynopsisNPC[]>(`/scenarios/${scenarioId}/synopsis/npcs/${npc.id}/status`, { status }),
    onSuccess: (data) => qc.setQueryData(['synopsis-npcs', scenarioId], data),
  })

  const remove = useMutation({
    mutationFn: () => api.delete(`/scenarios/${scenarioId}/synopsis/npcs/${npc.id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['synopsis-npcs', scenarioId] }),
  })

  const develop = useMutation({
    mutationFn: () => api.post<Record<string, string>>(`/scenarios/${scenarioId}/synopsis/llm/develop-npc/${npc.id}`, {
      current: localRef.current,
    }),
    onSuccess: (data) => setSuggestion(data),
  })

  async function regenerateFields(keys: string[], instruction: string) {
    return api.post<Record<string, string>>(`/scenarios/${scenarioId}/synopsis/llm/develop-npc/${npc.id}`, {
      current: localRef.current, fields: keys, instruction,
    })
  }

  // Everywhere else this NPC is shown reads one of these caches — patch them
  // as the user types instead of waiting for the debounced PUT.
  function patchCaches(patch: Partial<typeof local>) {
    patchCachedListItem<SynopsisNPC>(qc, ['synopsis-npcs', scenarioId], npc.id, patch)
    patchCachedListItem<CampaignNPC>(qc, ['campaign-npcs', npc.campaign_id], npc.id, patch)
  }

  function handle(field: keyof typeof local, value: string) {
    localRef.current = { ...localRef.current, [field]: value }
    setLocal({ ...localRef.current })
    prevRef.current = { ...prevRef.current, [field]: value }
    patchCaches({ [field]: value })
    draft.schedule(localRef.current, data => save.mutate(data))
  }

  function acceptField(key: string, value: string) {
    const merged = { ...localRef.current, [key]: value }
    localRef.current = merged
    prevRef.current = merged
    setLocal(merged)
    patchCaches(merged)
    draft.saveNow(merged, data => save.mutate(data))
  }

  const images: { url: string }[] = (() => { try { return JSON.parse(npc.images || '[]') } catch { return [] } })()
  const portrait = images[0] ?? null

  return (
    <li className="rounded-md border bg-card p-3 space-y-2">
      <div className="flex items-center gap-2">
        {portrait ? (
          <img src={portrait.url} alt={npc.name} className="h-8 w-8 rounded-full object-cover shrink-0" />
        ) : (
          <div className="h-8 w-8 rounded-full bg-muted shrink-0 flex items-center justify-center">
            <UserRound className="h-4 w-4 text-muted-foreground/40" />
          </div>
        )}
        <StatusBadge status={npc.status} onChange={status => updateStatus.mutate(status)} />
        <Input
          placeholder="Nom"
          value={local.name}
          onChange={e => handle('name', e.target.value)}
          className="h-7 text-sm font-medium flex-1"
          disabled={locked}
        />
        <Button
          size="sm" variant="ghost"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive shrink-0"
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      <Input
        placeholder="Rôle dans l'histoire"
        value={local.role}
        onChange={e => handle('role', e.target.value)}
        className="h-7 text-xs"
        disabled={locked}
      />

      <textarea
        ref={descRef}
        placeholder="Description (physique, psychologie, motivations…)"
        value={local.description}
        onChange={e => handle('description', e.target.value)}
        rows={2}
        className="w-full resize-none overflow-hidden rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        disabled={locked}
      />

      <Input
        placeholder="Motivation (ce qui le fait agir)"
        value={local.motivation}
        onChange={e => handle('motivation', e.target.value)}
        className="h-7 text-xs"
        disabled={locked}
      />

      <Input
        placeholder="Réplique type"
        value={local.quote}
        onChange={e => handle('quote', e.target.value)}
        className="h-7 text-xs italic"
        disabled={locked}
      />

      <div className="flex items-center gap-2 pt-0.5">
        {!suggestion && (
          <Button
            size="sm" variant="ghost" className="h-6 px-1.5 text-xs"
            disabled={locked || develop.isPending}
            onClick={() => develop.mutate()}
          >
            <Sparkles className="h-3 w-3 mr-0.5" />
            {develop.isPending ? 'Développement…' : 'Développer'}
          </Button>
        )}
        {develop.isError && <p className="text-xs text-destructive">{(develop.error as Error).message}</p>}
        {save.isPending && <span className="text-xs text-muted-foreground ml-auto">Sauvegarde…</span>}
      </div>

      {suggestion && !locked && (
        <LLMSuggestionReview
          fields={NPC_SUGGESTION_FIELDS}
          suggestion={suggestion}
          onAcceptField={acceptField}
          onRegenerate={regenerateFields}
          onDone={() => setSuggestion(null)}
        />
      )}
    </li>
  )
}

// ── Widget ────────────────────────────────────────────────────────────────

export default function NPCWidget({ scenarioId, campaignId }: Props) {
  const qc = useQueryClient()
  const [pickerOpen, setPickerOpen] = useState(false)

  const { data: npcs = [] } = useQuery({
    queryKey: ['synopsis-npcs', scenarioId],
    queryFn: () => api.get<SynopsisNPC[]>(`/scenarios/${scenarioId}/synopsis/npcs`),
  })

  const addNPC = useMutation({
    mutationFn: (npcId: string) =>
      api.post<SynopsisNPC[]>(`/scenarios/${scenarioId}/synopsis/npcs`, { npc_id: npcId }),
    onSuccess: (data) => {
      qc.setQueryData(['synopsis-npcs', scenarioId], data)
      setPickerOpen(false)
    },
  })

  const suggestNPCs = useMutation({
    mutationFn: () => api.post<SynopsisNPC[]>(`/scenarios/${scenarioId}/synopsis/llm/suggest-npcs`, {}),
    onSuccess: (data) => {
      qc.setQueryData(['synopsis-npcs', scenarioId], data)
      qc.invalidateQueries({ queryKey: ['campaign-npcs', campaignId] })
    },
  })

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">PNJs principaux</h3>
        <Button size="sm" variant="ghost" onClick={() => setPickerOpen(true)} className="h-7 px-2 text-xs">
          <Plus className="h-3.5 w-3.5 mr-1" /> Ajouter
        </Button>
      </div>

      {npcs.length === 0 && (
        <p className="text-xs text-muted-foreground">Aucun PNJ. Ajoutez-en un ou demandez au LLM.</p>
      )}

      <ul className="space-y-2">
        {npcs.map(npc => (
          <NPCRow key={npc.id} npc={npc} scenarioId={scenarioId} />
        ))}
      </ul>

      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm" variant="outline" className="h-7 px-2 text-xs"
          disabled={suggestNPCs.isPending}
          onClick={() => suggestNPCs.mutate()}
        >
          <Sparkles className="h-3.5 w-3.5 mr-1" />
          {suggestNPCs.isPending ? 'Génération…' : 'Suggérer des PNJs'}
        </Button>
        {suggestNPCs.isError && (
          <p className="text-xs text-destructive">{(suggestNPCs.error as Error).message}</p>
        )}
      </div>

      <NPCPickerDialog
        campaignId={campaignId}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={npc => addNPC.mutate(npc.id)}
      />
    </section>
  )
}
