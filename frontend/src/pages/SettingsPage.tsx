import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard'
import { Plus, Pencil, Trash2, X, FolderOpen, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import AppShell from '@/components/AppShell'
import { api } from '@/api/client'
import { useUser } from '@/stores/auth'
import { useDocTitle } from '@/hooks/useDocTitle'
import type { Game, GameDocument } from '@/types/game'

interface LLMConfig {
  base_url: string
  api_key: string
  model: string
  max_tokens: number
}

interface MistralConfig {
  api_key: string
  image_count: number
}

const defaultLLM: LLMConfig = { base_url: '', api_key: '', model: '', max_tokens: 2000 }
const defaultMistral: MistralConfig = { api_key: '', image_count: 3 }

// Masked placeholder returned by the API in place of a stored key (see backend crypto.MaskedKey).
const MASKED_KEY = '••••••••'
// Sentinel telling the backend to reuse the already-saved Mistral (image) key (see backend mistralKeySentinel).
const MISTRAL_KEY_SENTINEL = '__use_mistral_key__'

const MISTRAL_BASE_URL = 'https://api.mistral.ai/v1'
// Generous enough for synopsis/NPC/artefact generation without running into the 8000 cap.
const MISTRAL_DEFAULT_MAX_TOKENS = 4096

const MISTRAL_MODELS = [
  { value: 'mistral-large-latest', label: 'Mistral Large — le plus capable' },
  { value: 'mistral-medium-latest', label: 'Mistral Medium — équilibré' },
  { value: 'mistral-small-latest', label: 'Mistral Small — rapide et économique' },
]

function MistralLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="2" y="2" width="20" height="4.4" fill="#FFD800" />
      <rect x="2" y="7.2" width="10" height="4.4" fill="#FFAF00" />
      <rect x="14.6" y="7.2" width="7.4" height="4.4" fill="#FF8205" />
      <rect x="2" y="12.4" width="20" height="4.4" fill="#FA500F" />
      <rect x="2" y="17.6" width="7.4" height="4.4" fill="#E10500" />
      <rect x="14.6" y="17.6" width="7.4" height="4.4" fill="#E10500" />
    </svg>
  )
}

// ── Games section ─────────────────────────────────────────────────────────────

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function GameDocumentsDialog({ game, onClose }: { game: Game; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['game-documents', game.id],
    queryFn: () => api.get<GameDocument[]>(`/games/${game.id}/documents`),
  })

  const filtered = search.trim()
    ? docs.filter(d => d.name.toLowerCase().includes(search.toLowerCase()))
    : docs

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Documents — {game.name}</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-4">Chargement…</p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            Aucun fichier trouvé dans <code className="text-xs bg-muted px-1 rounded">external-material/{game.slug}/</code>
          </p>
        ) : (
          <div className="space-y-2">
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher…"
              autoFocus
              className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <ul className="space-y-0.5 max-h-72 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground px-2 py-2">Aucun résultat.</p>
              ) : filtered.map(d => (
                <li key={d.url}>
                  <a
                    href={d.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm px-2 py-1.5 rounded hover:bg-accent transition-colors"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{d.name}</span>
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function GamesSection() {
  const qc = useQueryClient()
  const { data: games = [] } = useQuery({
    queryKey: ['games'],
    queryFn: () => api.get<Game[]>('/games'),
  })

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [newGenre, setNewGenre] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSlug, setEditSlug] = useState('')
  const [editGenre, setEditGenre] = useState('')
  const [editVisualStyle, setEditVisualStyle] = useState('')
  const [origVisualStyle, setOrigVisualStyle] = useState('')
  const [docsGame, setDocsGame] = useState<Game | null>(null)

  const createGame = useMutation({
    mutationFn: (data: { name: string; slug: string; genre: string }) => api.post<Game>('/games', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['games'] })
      setAdding(false)
      setNewName('')
      setNewSlug('')
      setNewGenre('')
    },
  })

  const updateGame = useMutation({
    mutationFn: async ({ id, name, slug, genre }: { id: string; name: string; slug: string; genre: string }) => {
      await api.put<Game>(`/games/${id}`, { name, slug, genre })
      if (editVisualStyle !== origVisualStyle) {
        return api.put<Game>(`/games/${id}/visual-style`, { visual_style: editVisualStyle })
      }
      return api.get<Game>(`/games/${id}`)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['games'] })
      setEditingId(null)
    },
  })

  const generateVisualStyle = useMutation({
    mutationFn: (id: string) => api.post<{ visual_style: string }>(`/games/${id}/llm/generate-visual-style`, {}),
    onSuccess: (data) => setEditVisualStyle(data.visual_style),
  })

  const deleteGame = useMutation({
    mutationFn: (id: string) => api.delete(`/games/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['games'] }),
  })

  return (
    <>
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Jeux</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Systèmes de jeu disponibles pour vos campagnes.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />Ajouter
        </Button>
      </div>

      {games.length === 0 && !adding && (
        <p className="text-xs text-muted-foreground italic">Aucun jeu configuré.</p>
      )}

      <ul className="space-y-1">
        {games.map(g => (
          <li key={g.id}>
            {editingId === g.id ? (
              <div className="space-y-2 py-1">
                <div className="flex items-center gap-2">
                  <Input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="Nom"
                  />
                  <Input
                    value={editSlug}
                    onChange={e => setEditSlug(e.target.value)}
                    className="h-8 text-xs font-mono"
                    placeholder="slug"
                  />
                  <Button
                    size="sm"
                    className="h-8 px-2 text-xs"
                    disabled={!editName.trim() || !editSlug.trim() || updateGame.isPending}
                    onClick={() => updateGame.mutate({ id: g.id, name: editName.trim(), slug: editSlug.trim(), genre: editGenre.trim() })}
                  >
                    OK
                  </Button>
                  <button onClick={() => setEditingId(null)} className="text-muted-foreground/50 hover:text-muted-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Input
                  value={editGenre}
                  onChange={e => setEditGenre(e.target.value)}
                  className="h-8 text-xs"
                  placeholder="Genre (ex : cyberpunk, fantasy, horreur…)"
                />
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">Style visuel</p>
                    <Button
                      size="sm" variant="ghost" className="h-5 px-2 text-xs"
                      disabled={generateVisualStyle.isPending}
                      onClick={() => generateVisualStyle.mutate(g.id)}
                    >
                      <Sparkles className="h-3 w-3 mr-1" />
                      {generateVisualStyle.isPending ? 'Génération…' : 'Générer'}
                    </Button>
                  </div>
                  <textarea
                    value={editVisualStyle}
                    onChange={e => setEditVisualStyle(e.target.value)}
                    placeholder="Gritty neon-soaked noir, rain-slicked streets, cyan and amber lighting…"
                    rows={3}
                    className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  {generateVisualStyle.isError && (
                    <p className="text-xs text-destructive">{(generateVisualStyle.error as Error).message}</p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40 group">
                <span className="flex-1 text-sm">{g.name}</span>
                {g.genre && <span className="text-xs text-muted-foreground">{g.genre}</span>}
                <span className="text-xs text-muted-foreground font-mono">{g.slug}</span>
                <button
                  onClick={() => setDocsGame(g)}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-muted-foreground transition-opacity"
                  title="Voir les documents"
                >
                  <FolderOpen className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => { setEditingId(g.id); setEditName(g.name); setEditSlug(g.slug); setEditGenre(g.genre ?? ''); setEditVisualStyle(g.visual_style ?? ''); setOrigVisualStyle(g.visual_style ?? '') }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-muted-foreground transition-opacity"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => { if (confirm(`Supprimer "${g.name}" ?`)) deleteGame.mutate(g.id) }}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-destructive transition-opacity"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <Input
              value={newName}
              onChange={e => { setNewName(e.target.value); setNewSlug(slugify(e.target.value)) }}
              className="h-8 text-xs"
              placeholder="Nom (ex: Cyberpunk Red)"
              autoFocus
            />
            <Input
              value={newSlug}
              onChange={e => setNewSlug(e.target.value)}
              className="h-8 text-xs font-mono"
              placeholder="slug"
            />
            <Button
              size="sm"
              className="h-8 px-2 text-xs"
              disabled={!newName.trim() || !newSlug.trim() || createGame.isPending}
              onClick={() => createGame.mutate({ name: newName.trim(), slug: newSlug.trim(), genre: newGenre.trim() })}
            >
              Ajouter
            </Button>
            <button
              onClick={() => { setAdding(false); setNewName(''); setNewSlug(''); setNewGenre('') }}
              className="text-muted-foreground/50 hover:text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <Input
            value={newGenre}
            onChange={e => setNewGenre(e.target.value)}
            className="h-8 text-xs"
            placeholder="Genre (ex : cyberpunk, fantasy, horreur…)"
          />
        </div>
      )}
    </div>

    {docsGame && (
      <GameDocumentsDialog game={docsGame} onClose={() => setDocsGame(null)} />
    )}
    </>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  useDocTitle('lore — paramètres')
  const currentUser = useUser()

  const { data: llmData, isLoading: llmLoading } = useQuery({
    queryKey: ['settings', 'llm'],
    queryFn: () => api.get<LLMConfig>('/settings/llm'),
  })
  const { data: mistralData, isLoading: mistralLoading } = useQuery({
    queryKey: ['settings', 'mistral'],
    queryFn: () => api.get<MistralConfig>('/settings/mistral'),
  })

  const [llm, setLlm] = useState<LLMConfig>(defaultLLM)
  const [mistral, setMistral] = useState<MistralConfig>(defaultMistral)
  const [llmSaved, setLlmSaved] = useState(false)
  const [mistralSaved, setMistralSaved] = useState(false)

  useEffect(() => { if (llmData) setLlm(llmData) }, [llmData])
  useEffect(() => { if (mistralData) setMistral(mistralData) }, [mistralData])

  const llmDirty = JSON.stringify(llm) !== JSON.stringify(llmData ?? defaultLLM)
  const mistralDirty = JSON.stringify(mistral) !== JSON.stringify(mistralData ?? defaultMistral)

  const saveLLM = useMutation({
    mutationFn: (c: LLMConfig) => api.put<LLMConfig>('/settings/llm', c),
    onSuccess: (updated) => { setLlm(updated); setLlmSaved(true); setTimeout(() => setLlmSaved(false), 2000) },
  })
  const saveMistral = useMutation({
    mutationFn: (c: MistralConfig) => api.put<MistralConfig>('/settings/mistral', c),
    onSuccess: (updated) => { setMistral(updated); setMistralSaved(true); setTimeout(() => setMistralSaved(false), 2000) },
  })

  const { guardDialog } = useUnsavedGuard(llmDirty || mistralDirty, async () => {
    if (llmDirty) await saveLLM.mutateAsync(llm)
    if (mistralDirty) await saveMistral.mutateAsync(mistral)
  })

  function llmField(key: keyof LLMConfig) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setLlmSaved(false)
      const value = key === 'max_tokens' ? Number(e.target.value) : e.target.value
      setLlm(c => ({ ...c, [key]: value }))
    }
  }

  function mistralField(key: keyof MistralConfig) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setMistralSaved(false)
      const value = key === 'image_count' ? Number(e.target.value) : e.target.value
      setMistral(c => ({ ...c, [key]: value }))
    }
  }

  const isMistral = llm.base_url.trim() === MISTRAL_BASE_URL
  const hasMistralKey = mistral.api_key.trim() !== ''
  const usingSharedMistralKey = llm.api_key === MISTRAL_KEY_SENTINEL

  function useMistral() {
    setLlmSaved(false)
    setLlm(c => ({
      ...c,
      base_url: MISTRAL_BASE_URL,
      model: MISTRAL_MODELS.some(m => m.value === c.model) ? c.model : MISTRAL_MODELS[0].value,
      api_key: !hasMistralKey ? c.api_key : mistral.api_key === MASKED_KEY ? MISTRAL_KEY_SENTINEL : mistral.api_key,
      max_tokens: c.max_tokens >= 100 ? c.max_tokens : MISTRAL_DEFAULT_MAX_TOKENS,
    }))
  }

  // Everything on this page is instance-wide: the LLM endpoint and key every
  // campaign runs through, and the shared game catalogue. The backend refuses
  // these writes for anyone else, so don't show forms that would 403 on save.
  if (currentUser && currentUser.role !== 'superuser') {
    return (
      <AppShell crumbs={[{ label: 'Paramètres' }]}>
        <main className="max-w-2xl mx-auto px-6 py-16 text-center space-y-2">
          <p className="text-sm font-medium">Paramètres réservés aux administrateurs</p>
          <p className="text-sm text-muted-foreground">
            La configuration du LLM et la liste des jeux sont communes à toute l'instance.
          </p>
        </main>
      </AppShell>
    )
  }

  return (
    <AppShell crumbs={[{ label: 'Paramètres' }]}>
      <main className="max-w-xl mx-auto px-6 py-8 space-y-10">

        <GamesSection />

        <div className="border-t pt-10">
          <form onSubmit={e => { e.preventDefault(); saveLLM.mutate(llm) }} className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Configuration LLM</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Compatible avec toute API OpenAI-standard (Anthropic, Mistral, Ollama…)
              </p>
            </div>

            {llmLoading ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : (
              <div className="space-y-4">
                <button
                  type="button"
                  onClick={useMistral}
                  className="flex items-center gap-2 rounded-md border border-input bg-background px-3 py-2 text-sm hover:bg-accent transition-colors"
                  title="Pré-remplir avec l'API Mistral"
                >
                  <MistralLogo className="h-5 w-5 rounded-sm shrink-0" />
                  Utiliser Mistral
                  {hasMistralKey && (
                    <span className="text-xs text-muted-foreground">(clé des images réutilisée)</span>
                  )}
                </button>

                <div className="space-y-2">
                  <Label htmlFor="base_url">Base URL</Label>
                  <Input
                    id="base_url"
                    placeholder="https://api.anthropic.com/v1"
                    value={llm.base_url}
                    onChange={llmField('base_url')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="api_key">Clé API</Label>
                  <Input
                    id="api_key"
                    type="password"
                    placeholder="sk-…"
                    value={llm.api_key}
                    onChange={llmField('api_key')}
                  />
                  {usingSharedMistralKey && (
                    <p className="text-xs text-muted-foreground">
                      Réutilise la clé API Mistral de la section « Configuration Mistral » ci-dessous.
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="model">Modèle</Label>
                    {isMistral ? (
                      <select
                        id="model"
                        value={llm.model}
                        onChange={e => { setLlmSaved(false); setLlm(c => ({ ...c, model: e.target.value })) }}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {!MISTRAL_MODELS.some(m => m.value === llm.model) && llm.model && (
                          <option value={llm.model}>{llm.model}</option>
                        )}
                        {MISTRAL_MODELS.map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                    ) : (
                      <Input
                        id="model"
                        placeholder="claude-opus-4-20250514"
                        value={llm.model}
                        onChange={llmField('model')}
                      />
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="max_tokens">Max tokens</Label>
                    <Input
                      id="max_tokens"
                      type="number"
                      min={100}
                      max={8000}
                      value={llm.max_tokens}
                      onChange={llmField('max_tokens')}
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              {saveLLM.error && (
                <p className="text-destructive text-sm flex-1">{(saveLLM.error as Error).message}</p>
              )}
              {llmSaved && <p className="text-sm text-muted-foreground flex-1">Enregistré.</p>}
              <Button
                type="submit"
                disabled={!llmDirty || saveLLM.isPending}
                variant={llmDirty ? 'default' : 'outline'}
                className="ml-auto"
              >
                {saveLLM.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </div>
          </form>
        </div>

        <div className="border-t pt-10">
          <form onSubmit={e => { e.preventDefault(); saveMistral.mutate(mistral) }} className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Configuration Mistral</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Clé API Mistral pour la génération d'images d'artefacts.
              </p>
            </div>

            {mistralLoading ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="mistral_api_key">Clé API Mistral</Label>
                  <Input
                    id="mistral_api_key"
                    type="password"
                    placeholder="…"
                    value={mistral.api_key}
                    onChange={mistralField('api_key')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="image_count">Nombre d'images générées</Label>
                  <Input
                    id="image_count"
                    type="number"
                    min={1}
                    max={6}
                    value={mistral.image_count}
                    onChange={mistralField('image_count')}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              {saveMistral.error && (
                <p className="text-destructive text-sm flex-1">{(saveMistral.error as Error).message}</p>
              )}
              {mistralSaved && <p className="text-sm text-muted-foreground flex-1">Enregistré.</p>}
              <Button
                type="submit"
                disabled={!mistralDirty || saveMistral.isPending}
                variant={mistralDirty ? 'default' : 'outline'}
                className="ml-auto"
              >
                {saveMistral.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </div>
          </form>
        </div>
      </main>
      {guardDialog}
    </AppShell>
  )
}
