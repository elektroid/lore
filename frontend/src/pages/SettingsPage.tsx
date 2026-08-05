import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard'
import { Plus, Pencil, Trash2, X, FolderOpen, Sparkles, Download, Upload } from 'lucide-react'
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
  provider?: string
  max_tokens: number
}

interface ImageConfig {
  provider: string // 'mistral' | 'openrouter'
  mistral_api_key: string
  openrouter_api_key: string
  openrouter_model: string
  image_count: number
}

interface ModelInfo {
  id: string
}

const defaultLLM: LLMConfig = { base_url: '', api_key: '', model: '', max_tokens: 2000 }
const defaultImage: ImageConfig = {
  provider: 'mistral',
  mistral_api_key: '',
  openrouter_api_key: '',
  openrouter_model: '',
  image_count: 3,
}

// Masked placeholder returned by the API in place of a stored key (see backend crypto.MaskedKey).
const MASKED_KEY = '••••••••'
// Sentinel telling the backend to reuse the already-saved Mistral (image) key (see backend mistralKeySentinel).
const MISTRAL_KEY_SENTINEL = '__use_mistral_key__'

// Generous enough for synopsis/NPC/artefact generation without running into the 8000 cap.
const MISTRAL_DEFAULT_MAX_TOKENS = 4096

// Mirrors backend llm.Providers — presets only prefill the form, any base_url works.
const LLM_PROVIDERS = [
  { id: 'mistral', label: 'Mistral', base_url: 'https://api.mistral.ai/v1' },
  { id: 'ollama', label: 'Ollama (local)', base_url: 'http://localhost:11434/v1' },
  { id: 'openrouter', label: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1' },
  { id: 'custom', label: 'Personnalisé', base_url: '' },
]

const MISTRAL_MODELS = [
  { value: 'mistral-large-latest', label: 'Mistral Large — le plus capable' },
  { value: 'mistral-medium-latest', label: 'Mistral Medium — équilibré' },
  { value: 'mistral-small-latest', label: 'Mistral Small — rapide et économique' },
]

// Only listing models actually verified against OpenRouter's dedicated
// Images API (POST /images) — a different endpoint from chat completions,
// so not every "image-capable" chat model works here. Free text covers the rest.
const OPENROUTER_IMAGE_MODELS = [
  { value: 'qwen/qwen-image-3-pro', label: 'Qwen Image 3 Pro' },
]

function detectProvider(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  const match = LLM_PROVIDERS.find(p => p.id !== 'custom' && p.base_url === trimmed)
  return match ? match.id : 'custom'
}

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

  const importInputRef = useRef<HTMLInputElement>(null)
  const importGame = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData()
      form.append('file', file)
      return api.upload<Game>('/games/import', form)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['games'] }),
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
        <div className="flex items-center gap-2">
          <input
            ref={importInputRef}
            type="file"
            accept=".zip"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) importGame.mutate(file)
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={importGame.isPending}
            onClick={() => importInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5 mr-1" />
            {importGame.isPending ? 'Import…' : 'Importer'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />Ajouter
          </Button>
        </div>
      </div>

      {importGame.isError && (
        <p className="text-xs text-destructive">{(importGame.error as Error).message}</p>
      )}

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
                <a
                  href={`/api/games/${g.id}/export`}
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground/60 hover:text-muted-foreground transition-opacity"
                  title="Exporter (.zip)"
                >
                  <Download className="h-3.5 w-3.5" />
                </a>
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
  const { data: imageData, isLoading: imageLoading } = useQuery({
    queryKey: ['settings', 'images'],
    queryFn: () => api.get<ImageConfig>('/settings/images'),
  })

  const [llm, setLlm] = useState<LLMConfig>(defaultLLM)
  const [image, setImage] = useState<ImageConfig>(defaultImage)
  const [llmSaved, setLlmSaved] = useState(false)
  const [imageSaved, setImageSaved] = useState(false)
  const [modelOptions, setModelOptions] = useState<string[]>([])

  useEffect(() => { if (llmData) setLlm(llmData) }, [llmData])
  useEffect(() => { if (imageData) setImage(imageData) }, [imageData])

  const llmDirty = JSON.stringify(llm) !== JSON.stringify(llmData ?? defaultLLM)
  const imageDirty = JSON.stringify(image) !== JSON.stringify(imageData ?? defaultImage)

  const saveLLM = useMutation({
    mutationFn: (c: LLMConfig) => api.put<LLMConfig>('/settings/llm', c),
    onSuccess: (updated) => { setLlm(updated); setLlmSaved(true); setTimeout(() => setLlmSaved(false), 2000) },
  })
  const saveImage = useMutation({
    mutationFn: (c: ImageConfig) => api.put<ImageConfig>('/settings/images', c),
    onSuccess: (updated) => { setImage(updated); setImageSaved(true); setTimeout(() => setImageSaved(false), 2000) },
  })
  const listModels = useMutation({
    mutationFn: () => api.post<ModelInfo[]>('/settings/llm/models', { base_url: llm.base_url, api_key: llm.api_key }),
    onSuccess: (models) => setModelOptions(models.map(m => m.id).sort()),
  })

  const { guardDialog } = useUnsavedGuard(llmDirty || imageDirty, async () => {
    if (llmDirty) await saveLLM.mutateAsync(llm)
    if (imageDirty) await saveImage.mutateAsync(image)
  })

  function llmField(key: keyof LLMConfig) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setLlmSaved(false)
      const value = key === 'max_tokens' ? Number(e.target.value) : e.target.value
      setLlm(c => ({ ...c, [key]: value }))
    }
  }

  function imageField(key: keyof ImageConfig) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      setImageSaved(false)
      const value = key === 'image_count' ? Number(e.target.value) : e.target.value
      setImage(c => ({ ...c, [key]: value }))
    }
  }

  const llmProvider = llm.provider && LLM_PROVIDERS.some(p => p.id === llm.provider) ? llm.provider : detectProvider(llm.base_url)
  const hasMistralImageKey = image.mistral_api_key.trim() !== ''
  const usingSharedMistralKey = llm.api_key === MISTRAL_KEY_SENTINEL

  function selectLLMProvider(id: string) {
    setLlmSaved(false)
    setModelOptions([])
    const preset = LLM_PROVIDERS.find(p => p.id === id)
    if (!preset) return
    setLlm(c => ({
      ...c,
      provider: id,
      base_url: preset.base_url || c.base_url,
      // A model id from the previous provider is very unlikely to be valid on
      // the new one — clear it rather than silently carrying it forward.
      model: id === 'mistral' ? (MISTRAL_MODELS.some(m => m.value === c.model) ? c.model : MISTRAL_MODELS[0].value) : '',
      api_key: id === 'mistral' && hasMistralImageKey
        ? (image.mistral_api_key === MASKED_KEY ? MISTRAL_KEY_SENTINEL : image.mistral_api_key)
        : c.api_key,
      max_tokens: id === 'mistral' && c.max_tokens < 100 ? MISTRAL_DEFAULT_MAX_TOKENS : c.max_tokens,
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
              <h2 className="text-lg font-semibold">LLM (texte)</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Utilisé pour la rédaction assistée : PNJ, lieux, factions, scènes, brainstorm…
              </p>
            </div>

            {llmLoading ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="llm_provider">Fournisseur</Label>
                  <div className="flex items-center gap-2">
                    {llmProvider === 'mistral' && <MistralLogo className="h-5 w-5 rounded-sm shrink-0" />}
                    <select
                      id="llm_provider"
                      value={llmProvider}
                      onChange={e => selectLLMProvider(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      {LLM_PROVIDERS.map(p => (
                        <option key={p.id} value={p.id}>{p.label}</option>
                      ))}
                    </select>
                  </div>
                  {llmProvider === 'mistral' && hasMistralImageKey && (
                    <p className="text-xs text-muted-foreground">
                      La clé API Mistral de la section « Génération d'images » ci-dessous est réutilisée automatiquement.
                    </p>
                  )}
                </div>

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
                    placeholder={llmProvider === 'ollama' ? 'ollama (souvent inutile en local)' : 'sk-…'}
                    value={llm.api_key}
                    onChange={llmField('api_key')}
                  />
                  {usingSharedMistralKey && (
                    <p className="text-xs text-muted-foreground">
                      Réutilise la clé API Mistral de la section « Génération d'images » ci-dessous.
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="model">Modèle</Label>
                      <Button
                        type="button" size="sm" variant="ghost" className="h-5 px-2 text-xs"
                        disabled={!llm.base_url.trim() || listModels.isPending}
                        onClick={() => listModels.mutate()}
                      >
                        {listModels.isPending ? 'Chargement…' : 'Charger les modèles'}
                      </Button>
                    </div>
                    {modelOptions.length > 0 ? (
                      <select
                        id="model"
                        value={llm.model}
                        onChange={e => { setLlmSaved(false); setLlm(c => ({ ...c, model: e.target.value })) }}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {!modelOptions.includes(llm.model) && llm.model && (
                          <option value={llm.model}>{llm.model}</option>
                        )}
                        {modelOptions.map(id => (
                          <option key={id} value={id}>{id}</option>
                        ))}
                      </select>
                    ) : llmProvider === 'mistral' ? (
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
                    {listModels.isError && (
                      <p className="text-xs text-destructive">{(listModels.error as Error).message}</p>
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
          <form onSubmit={e => { e.preventDefault(); saveImage.mutate(image) }} className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold">Génération d'images</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Portraits, lieux, emblèmes et artefacts illustrés — section distincte du LLM de texte ci-dessus.
              </p>
            </div>

            {imageLoading ? (
              <p className="text-sm text-muted-foreground">Chargement…</p>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="image_provider">Fournisseur</Label>
                  <div className="flex items-center gap-2">
                    {image.provider === 'mistral' && <MistralLogo className="h-5 w-5 rounded-sm shrink-0" />}
                    <select
                      id="image_provider"
                      value={image.provider}
                      onChange={e => {
                        setImageSaved(false)
                        const provider = e.target.value
                        setImage(c => ({
                          ...c,
                          provider,
                          // Pre-fill so the select's own default (its first
                          // <option>) always matches the stored state —
                          // otherwise it *looks* set but saves as "".
                          openrouter_model: provider === 'openrouter' && !c.openrouter_model
                            ? OPENROUTER_IMAGE_MODELS[0].value
                            : c.openrouter_model,
                        }))
                      }}
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="mistral">Mistral</option>
                      <option value="openrouter">OpenRouter</option>
                    </select>
                  </div>
                </div>

                {image.provider === 'openrouter' ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="openrouter_api_key">Clé API OpenRouter</Label>
                      <Input
                        id="openrouter_api_key"
                        type="password"
                        placeholder="sk-or-…"
                        value={image.openrouter_api_key}
                        onChange={imageField('openrouter_api_key')}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="openrouter_model">Modèle</Label>
                      <select
                        id="openrouter_model"
                        value={image.openrouter_model}
                        onChange={e => { setImageSaved(false); setImage(c => ({ ...c, openrouter_model: e.target.value })) }}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        {!image.openrouter_model && <option value="">— choisir —</option>}
                        {!OPENROUTER_IMAGE_MODELS.some(m => m.value === image.openrouter_model) && image.openrouter_model && (
                          <option value={image.openrouter_model}>{image.openrouter_model}</option>
                        )}
                        {OPENROUTER_IMAGE_MODELS.map(m => (
                          <option key={m.value} value={m.value}>{m.label}</option>
                        ))}
                      </select>
                      <Input
                        placeholder="ou un autre id de modèle (ex : bytedance-seed/seedream-4.5)"
                        value={OPENROUTER_IMAGE_MODELS.some(m => m.value === image.openrouter_model) ? '' : image.openrouter_model}
                        onChange={imageField('openrouter_model')}
                      />
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="mistral_api_key">Clé API Mistral</Label>
                    <Input
                      id="mistral_api_key"
                      type="password"
                      placeholder="…"
                      value={image.mistral_api_key}
                      onChange={imageField('mistral_api_key')}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="image_count">Nombre d'images générées</Label>
                  <Input
                    id="image_count"
                    type="number"
                    min={1}
                    max={6}
                    value={image.image_count}
                    onChange={imageField('image_count')}
                  />
                </div>
              </div>
            )}

            <div className="flex items-center gap-3">
              {saveImage.error && (
                <p className="text-destructive text-sm flex-1">{(saveImage.error as Error).message}</p>
              )}
              {imageSaved && <p className="text-sm text-muted-foreground flex-1">Enregistré.</p>}
              <Button
                type="submit"
                disabled={!imageDirty || saveImage.isPending}
                variant={imageDirty ? 'default' : 'outline'}
                className="ml-auto"
              >
                {saveImage.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </Button>
            </div>
          </form>
        </div>
      </main>
      {guardDialog}
    </AppShell>
  )
}
