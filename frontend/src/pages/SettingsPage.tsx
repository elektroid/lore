import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AppShell from '@/components/AppShell'
import { api } from '@/api/client'
import { useUser } from '@/stores/auth'
import { useDocTitle } from '@/hooks/useDocTitle'

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

interface PasswordResetSetting {
  enabled: boolean
  smtp_configured: boolean
}

interface ServerInfo {
  version: string
  commit: string
  build_time: string
  go_version: string
  os: string
  arch: string
  uptime_seconds: number
  disk: { free_bytes: number; total_bytes: number }
  database_bytes: number
  uploads_bytes: number
  external_material_bytes: number
  user_count: number
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 o'
  const units = ['o', 'Ko', 'Mo', 'Go', 'To']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days} j ${hours} h`
  if (hours > 0) return `${hours} h ${minutes} min`
  return `${minutes} min`
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
  const { data: serverInfo, isLoading: serverInfoLoading } = useQuery({
    queryKey: ['settings', 'server-info'],
    queryFn: () => api.get<ServerInfo>('/settings/server-info'),
    enabled: currentUser?.role === 'superuser',
  })
  const { data: passwordReset, isLoading: passwordResetLoading } = useQuery({
    queryKey: ['settings', 'password-reset'],
    queryFn: () => api.get<PasswordResetSetting>('/settings/password-reset'),
  })
  const queryClient = useQueryClient()
  const togglePasswordReset = useMutation({
    mutationFn: (enabled: boolean) => api.put<PasswordResetSetting>('/settings/password-reset', { enabled }),
    onSuccess: (updated) => queryClient.setQueryData(['settings', 'password-reset'], updated),
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

        <div>
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

        <div className="border-t pt-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold">Mot de passe oublié</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Autorise les comptes à demander un lien de réinitialisation par email.
              </p>
            </div>
            {!passwordResetLoading && passwordReset && (
              <button
                type="button"
                role="switch"
                aria-checked={passwordReset.enabled}
                disabled={togglePasswordReset.isPending}
                onClick={() => togglePasswordReset.mutate(!passwordReset.enabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${
                  passwordReset.enabled ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                    passwordReset.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            )}
          </div>

          {!passwordResetLoading && passwordReset && !passwordReset.smtp_configured && (
            <p className="text-xs text-amber-600 dark:text-amber-500 mt-3">
              Aucun serveur SMTP n'est configuré (section <code>[smtp]</code> de <code>lore.toml</code>) —
              même activé, ce réglage n'enverra aucun email tant que ce n'est pas fait.
            </p>
          )}
          {togglePasswordReset.error && (
            <p className="text-destructive text-xs mt-3">{(togglePasswordReset.error as Error).message}</p>
          )}
        </div>

        <div className="border-t pt-10">
          <div>
            <h2 className="text-lg font-semibold">Serveur</h2>
            <p className="text-xs text-muted-foreground mt-1">
              État de l'instance — espace disque, volumétrie des données, version en cours d'exécution.
            </p>
          </div>

          {serverInfoLoading ? (
            <p className="text-sm text-muted-foreground mt-4">Chargement…</p>
          ) : !serverInfo ? (
            <p className="text-sm text-muted-foreground mt-4">Indisponible.</p>
          ) : (
            <div className="mt-4 space-y-4">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span>Espace disque libre</span>
                  <span className="text-muted-foreground">
                    {formatBytes(serverInfo.disk.free_bytes)} / {formatBytes(serverInfo.disk.total_bytes)}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{
                      width: serverInfo.disk.total_bytes
                        ? `${Math.min(100, (1 - serverInfo.disk.free_bytes / serverInfo.disk.total_bytes) * 100)}%`
                        : '0%',
                    }}
                  />
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <div>
                  <dt className="text-muted-foreground text-xs">Base de données</dt>
                  <dd>{formatBytes(serverInfo.database_bytes)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Images et fichiers</dt>
                  <dd>{formatBytes(serverInfo.uploads_bytes)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Documents externes</dt>
                  <dd>{formatBytes(serverInfo.external_material_bytes)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Utilisateurs</dt>
                  <dd>{serverInfo.user_count}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">En ligne depuis</dt>
                  <dd>{formatUptime(serverInfo.uptime_seconds)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Version</dt>
                  <dd>{serverInfo.version}{serverInfo.commit ? ` (${serverInfo.commit.slice(0, 7)})` : ''}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground text-xs">Go / OS</dt>
                  <dd>{serverInfo.go_version} · {serverInfo.os}/{serverInfo.arch}</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </main>
      {guardDialog}
    </AppShell>
  )
}
