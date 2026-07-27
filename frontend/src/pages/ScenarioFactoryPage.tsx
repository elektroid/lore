import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles, RotateCw, Check, ArrowLeft, Wand2 } from 'lucide-react'
import AppShell from '@/components/AppShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import BriefForm from '@/components/factory/BriefForm'
import BeatCard from '@/components/factory/BeatCard'
import CastPanel from '@/components/factory/CastPanel'
import { AutoTextarea, FieldLabel } from '@/components/factory/fields'
import { useDocTitle } from '@/hooks/useDocTitle'
import { api } from '@/api/client'
import { parseProposal, type Proposal, type ScenarioDraft, type ProposalScene } from '@/types/factory'
import type { Campaign } from '@/types/campaign'
import type { Scenario } from '@/types/scenario'
import type { CampaignNPC, CampaignLocation, CampaignFaction, CampaignArtefact } from '@/types/entities'

const SAVE_DEBOUNCE_MS = 1000

/** Mirrors the backend's commit-time identity (matchKey): case-, accent- and
 *  whitespace-insensitive, so the review screen marks exactly the items that
 *  will bind to an existing campaign row instead of creating a second one. */
function foldName(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')
}

export default function ScenarioFactoryPage() {
  const { id: campaignId } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [draftId, setDraftId] = useState('')
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [title, setTitle] = useState('')
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [instruction, setInstruction] = useState('')
  const [saving, setSaving] = useState(false)

  // Pattern C (DESIGN.md): refs mirror state so the debounced save never reads
  // a stale closure, and a pending save can be flushed before any server-side
  // operation that reads the draft back.
  const proposalRef = useRef<Proposal | null>(null)
  const titleRef = useRef('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dirtyRef = useRef(false)
  const adoptedRef = useRef('')

  const { data: campaign } = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => api.get<Campaign>(`/campaigns/${campaignId}`),
  })

  const { data: drafts = [] } = useQuery({
    queryKey: ['scenario-drafts', campaignId],
    queryFn: () => api.get<ScenarioDraft[]>(`/campaigns/${campaignId}/scenario-drafts`),
  })

  const { data: draft } = useQuery({
    queryKey: ['scenario-draft', draftId],
    queryFn: () => api.get<ScenarioDraft>(`/scenario-drafts/${draftId}`),
    enabled: !!draftId,
  })

  // What the campaign already holds — so the review screen can mark which
  // proposed items will bind to an existing row rather than create a new one.
  const { data: npcs = [] } = useQuery({
    queryKey: ['campaign-npcs', campaignId],
    queryFn: () => api.get<CampaignNPC[]>(`/campaigns/${campaignId}/npcs`),
  })
  const { data: locations = [] } = useQuery({
    queryKey: ['campaign-locations', campaignId],
    queryFn: () => api.get<CampaignLocation[]>(`/campaigns/${campaignId}/locations`),
  })
  const { data: factions = [] } = useQuery({
    queryKey: ['campaign-factions', campaignId],
    queryFn: () => api.get<CampaignFaction[]>(`/campaigns/${campaignId}/factions`),
  })
  const { data: artefacts = [] } = useQuery({
    queryKey: ['campaign-artefacts', campaignId],
    queryFn: () => api.get<CampaignArtefact[]>(`/campaigns/${campaignId}/artefacts`),
  })

  const existingNames = new Set(
    [...npcs, ...locations, ...factions, ...artefacts].map(e => foldName(e.name)),
  )

  useDocTitle(campaign ? `lore: fabrique — ${campaign.name}` : 'lore: fabrique')

  const adopt = useCallback((d: ScenarioDraft) => {
    const p = parseProposal(d)
    proposalRef.current = p
    titleRef.current = d.title || p.title
    dirtyRef.current = false
    setProposal(p)
    setTitle(d.title || p.title)
    adoptedRef.current = d.id
  }, [])

  // Adopt a draft once, when it first arrives. Later refetches must not clobber
  // edits the GM is in the middle of making.
  useEffect(() => {
    if (draft && adoptedRef.current !== draft.id) adopt(draft)
  }, [draft, adopt])

  const save = useMutation({
    mutationFn: (body: { title: string; proposal: Proposal }) =>
      api.put<ScenarioDraft>(`/scenario-drafts/${draftId}`, body),
    onSuccess: (d) => {
      qc.setQueryData(['scenario-draft', d.id], d)
      qc.invalidateQueries({ queryKey: ['scenario-drafts', campaignId] })
    },
  })

  const flush = useCallback(async () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (!dirtyRef.current || !proposalRef.current || !draftId) return
    dirtyRef.current = false
    setSaving(true)
    try {
      await save.mutateAsync({ title: titleRef.current, proposal: proposalRef.current })
    } finally {
      setSaving(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId])

  // Don't lose the last keystrokes to the debounce when leaving the page.
  useEffect(() => () => { void flush() }, [flush])

  function patchProposal(updater: (p: Proposal) => Proposal) {
    if (!proposalRef.current) return
    const next = updater(proposalRef.current)
    proposalRef.current = next
    setProposal(next)
    dirtyRef.current = true
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { void flush() }, SAVE_DEBOUNCE_MS)
  }

  function patchTitle(v: string) {
    titleRef.current = v
    setTitle(v)
    patchProposal(p => ({ ...p, title: v }))
  }

  function patchScene(ref: string, patch: Partial<ProposalScene>) {
    patchProposal(p => {
      const scenes = p.scenes.map(s => {
        if (s.ref !== ref) {
          // Only one scene can be the start, same rule as the synopsis editor.
          return patch.is_start ? { ...s, is_start: false } : s
        }
        return { ...s, ...patch }
      })
      // A beat sheet with no entry point is a list, not a story — the backend
      // re-asserts this on save, so mirror it here rather than let the screen
      // disagree with what would be committed.
      if (scenes.length > 0 && !scenes.some(s => s.is_start)) {
        scenes[0] = { ...scenes[0], is_start: true }
      }
      return { ...p, scenes }
    })
  }

  // ── LLM operations ─────────────────────────────────────────────────────────

  const generate = useMutation({
    mutationFn: (body: { brief: string; scene_count: number }) =>
      api.post<ScenarioDraft>(`/campaigns/${campaignId}/scenario-drafts`, body),
    onSuccess: (d) => {
      qc.setQueryData(['scenario-draft', d.id], d)
      qc.invalidateQueries({ queryKey: ['scenario-drafts', campaignId] })
      adopt(d)
      setDraftId(d.id)
      setError('')
    },
    onError: (e: Error) => setError(e.message),
  })

  const removeDraft = useMutation({
    mutationFn: (id: string) => api.delete(`/scenario-drafts/${id}`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['scenario-drafts', campaignId] })
      if (id === draftId) { setDraftId(''); setProposal(null); adoptedRef.current = '' }
    },
  })

  /** Expand one beat. Bare call writes into the draft; the review path asks for
   *  a suggestion instead, so the GM decides field by field. */
  async function expandScene(ref: string, fields: string[], instr: string): Promise<Record<string, string>> {
    await flush()
    const scene = proposalRef.current?.scenes.find(s => s.ref === ref)
    return api.post<Record<string, string>>(`/scenario-drafts/${draftId}/scenes/${ref}/expand`, {
      review: true,
      fields,
      instruction: instr,
      current: {
        description: scene?.description ?? '',
        outcome: scene?.outcome ?? '',
        notes: scene?.notes ?? '',
      },
    })
  }

  async function expandAll() {
    if (!proposalRef.current) return
    setError('')
    await flush()
    const pending = proposalRef.current.scenes.filter(s => s.include && !s.expanded)
    if (pending.length === 0) return

    setProgress({ done: 0, total: pending.length })
    try {
      for (let i = 0; i < pending.length; i++) {
        const updated = await api.post<ScenarioDraft>(
          `/scenario-drafts/${draftId}/scenes/${pending[i].ref}/expand`, {},
        )
        adopt(updated)
        qc.setQueryData(['scenario-draft', updated.id], updated)
        setProgress({ done: i + 1, total: pending.length })
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setProgress(null)
    }
  }

  const regenerate = useMutation({
    mutationFn: async () => {
      await flush()
      return api.post<ScenarioDraft>(`/scenario-drafts/${draftId}/regenerate`, { instruction })
    },
    onSuccess: (d) => {
      adopt(d)
      qc.setQueryData(['scenario-draft', d.id], d)
      setInstruction('')
      setError('')
    },
    onError: (e: Error) => setError(e.message),
  })

  const commit = useMutation({
    mutationFn: async () => {
      await flush()
      return api.post<Scenario>(`/scenario-drafts/${draftId}/commit`, { name: titleRef.current })
    },
    onSuccess: (scenario) => {
      qc.invalidateQueries({ queryKey: ['scenarios', campaignId] })
      navigate(`/scenarios/${scenario.id}/synopsis`)
    },
    onError: (e: Error) => setError(e.message),
  })

  // ── Render ─────────────────────────────────────────────────────────────────

  const crumbs = [
    { label: campaign?.name ?? '…', to: campaign ? `/campaigns/${campaign.id}` : undefined },
    { label: 'Fabrique' },
  ]

  if (!draftId || !proposal) {
    return (
      <AppShell crumbs={crumbs}>
        <main className="max-w-3xl mx-auto px-6 py-8">
          <BriefForm
            drafts={drafts}
            isGenerating={generate.isPending}
            error={error}
            onGenerate={(brief, sceneCount) => generate.mutate({ brief, scene_count: sceneCount })}
            onOpen={setDraftId}
            onDelete={id => removeDraft.mutate(id)}
          />
        </main>
      </AppShell>
    )
  }

  const committed = draft?.status === 'committed'
  const busy = !!progress || regenerate.isPending || commit.isPending
  const includedScenes = proposal.scenes.filter(s => s.include).length
  const notExpanded = proposal.scenes.filter(s => s.include && !s.expanded).length

  return (
    <AppShell crumbs={crumbs}>
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-5">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Button
            size="sm" variant="ghost" className="h-8 px-2 shrink-0 mt-1"
            onClick={async () => { await flush(); setDraftId(''); setProposal(null); adoptedRef.current = '' }}
            title="Retour aux brouillons"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex-1 space-y-1">
            <input
              value={title}
              onChange={e => patchTitle(e.target.value)}
              placeholder="Titre du scénario"
              disabled={busy || committed}
              className="text-2xl font-bold bg-transparent border-none outline-none w-full placeholder:text-muted-foreground/50 focus:ring-0 disabled:opacity-60"
            />
            <p className="text-xs text-muted-foreground">
              {saving ? 'Sauvegarde…' : 'Brouillon — rien n\'entre dans la campagne avant validation.'}
            </p>
          </div>
        </div>

        {committed && (
          <div className="rounded-md border border-primary/30 bg-primary/[0.04] px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-sm">Ce brouillon a déjà été transformé en scénario.</p>
            {draft?.scenario_id && (
              <Button size="sm" variant="outline" onClick={() => navigate(`/scenarios/${draft.scenario_id}/synopsis`)}>
                Ouvrir le scénario
              </Button>
            )}
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Pitch */}
        <div className="rounded-lg border bg-card p-4 space-y-1.5">
          <FieldLabel>Synopsis</FieldLabel>
          <AutoTextarea
            value={proposal.pitch}
            onChange={v => patchProposal(p => ({ ...p, pitch: v }))}
            placeholder="L'accroche du scénario"
            rows={3}
            disabled={busy || committed}
          />
        </div>

        {/* Cast */}
        <CastPanel
          proposal={proposal}
          existingNames={existingNames}
          onPatchFaction={(ref, patch) => patchProposal(p => ({ ...p, factions: p.factions.map(f => f.ref === ref ? { ...f, ...patch } : f) }))}
          onPatchLocation={(ref, patch) => patchProposal(p => ({ ...p, locations: p.locations.map(l => l.ref === ref ? { ...l, ...patch } : l) }))}
          onPatchNPC={(ref, patch) => patchProposal(p => ({ ...p, npcs: p.npcs.map(n => n.ref === ref ? { ...n, ...patch } : n) }))}
          onPatchArtefact={(ref, patch) => patchProposal(p => ({ ...p, artefacts: p.artefacts.map(a => a.ref === ref ? { ...a, ...patch } : a) }))}
        />

        {/* Beat sheet */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm font-medium">
              Déroulé <span className="text-muted-foreground font-normal">({includedScenes} scènes retenues)</span>
            </p>
            {notExpanded > 0 && !committed && (
              <Button size="sm" variant="outline" className="h-7 text-xs" disabled={busy} onClick={expandAll}>
                <Wand2 className={`h-3.5 w-3.5 mr-1 ${progress ? 'animate-pulse' : ''}`} />
                {progress
                  ? `Développement ${progress.done}/${progress.total}…`
                  : `Développer les ${notExpanded} scènes restantes`}
              </Button>
            )}
          </div>

          {progress && (
            <div className="h-1 w-full rounded bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          )}

          <ul className="space-y-1.5">
            {proposal.scenes.map((scene, i) => (
              <BeatCard
                key={scene.ref}
                scene={scene}
                index={i}
                proposal={proposal}
                busy={busy || committed}
                onPatch={patch => patchScene(scene.ref, patch)}
                onExpand={(fields, instr) => expandScene(scene.ref, fields, instr)}
              />
            ))}
          </ul>
        </div>

        {/* Footer actions */}
        {!committed && (
          <div className="rounded-lg border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Input
                value={instruction}
                onChange={e => setInstruction(e.target.value)}
                placeholder="Précisions pour un nouveau jet : plus court, plus sombre, moins de corpo…"
                disabled={busy}
                className="h-8 text-xs flex-1"
              />
              <Button
                size="sm" variant="outline" className="h-8 text-xs shrink-0"
                disabled={busy}
                onClick={() => regenerate.mutate()}
                title="Repart de la même idée de départ et remplace toute la proposition"
              >
                <RotateCw className={`h-3.5 w-3.5 mr-1 ${regenerate.isPending ? 'animate-spin' : ''}`} />
                {regenerate.isPending ? 'Nouveau jet…' : 'Tout régénérer'}
              </Button>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1 border-t flex-wrap">
              <p className="text-xs text-muted-foreground">
                {includedScenes} scènes,{' '}
                {proposal.npcs.filter(n => n.include).length} PNJs,{' '}
                {proposal.locations.filter(l => l.include).length} lieux,{' '}
                {proposal.factions.filter(f => f.include).length} factions seront créés.
              </p>
              <Button disabled={busy || includedScenes === 0} onClick={() => commit.mutate()}>
                <Check className="h-4 w-4" />
                {commit.isPending ? 'Création…' : 'Créer le scénario'}
              </Button>
            </div>
          </div>
        )}

        {includedScenes === 0 && (
          <p className="text-xs text-muted-foreground text-right">
            <Sparkles className="h-3 w-3 inline mr-1" />
            Retenez au moins une scène pour créer le scénario.
          </p>
        )}
      </main>
    </AppShell>
  )
}
