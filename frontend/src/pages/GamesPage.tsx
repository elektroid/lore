import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X, FolderOpen, Sparkles, Download, Upload, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import AppShell from '@/components/AppShell'
import { api } from '@/api/client'
import { useUser } from '@/stores/auth'
import { useDocTitle } from '@/hooks/useDocTitle'
import type { Game, GameDocument } from '@/types/game'
import type { SheetTemplate } from '@/types/sheetTemplate'

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

export default function GamesPage() {
  useDocTitle('lore: jeux')
  const navigate = useNavigate()
  const isAdmin = useUser()?.role === 'superuser'
  const qc = useQueryClient()
  const { data: games = [], isLoading } = useQuery({
    queryKey: ['games'],
    queryFn: () => api.get<Game[]>('/games'),
  })
  const { data: sheetTemplates = [] } = useQuery({
    queryKey: ['sheet-templates'],
    queryFn: () => api.get<SheetTemplate[]>('/sheet-templates'),
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
  const [newDescription, setNewDescription] = useState('')
  const [newSheetTemplateId, setNewSheetTemplateId] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editSlug, setEditSlug] = useState('')
  const [editGenre, setEditGenre] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editSheetTemplateId, setEditSheetTemplateId] = useState('')
  const [editVisualStyle, setEditVisualStyle] = useState('')
  const [origVisualStyle, setOrigVisualStyle] = useState('')
  const [docsGame, setDocsGame] = useState<Game | null>(null)

  const createGame = useMutation({
    mutationFn: (data: { name: string; slug: string; genre: string; description: string; sheet_template_id: string | null }) =>
      api.post<Game>('/games', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['games'] })
      setAdding(false)
      setNewName('')
      setNewSlug('')
      setNewGenre('')
      setNewDescription('')
      setNewSheetTemplateId('')
    },
  })

  const updateGame = useMutation({
    mutationFn: async ({ id, name, slug, genre, description, sheet_template_id }: { id: string; name: string; slug: string; genre: string; description: string; sheet_template_id: string | null }) => {
      await api.put<Game>(`/games/${id}`, { name, slug, genre, description, sheet_template_id })
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

  function startEdit(g: Game) {
    setEditingId(g.id)
    setEditName(g.name)
    setEditSlug(g.slug)
    setEditGenre(g.genre ?? '')
    setEditDescription(g.description ?? '')
    setEditSheetTemplateId(g.sheet_template_id ?? '')
    setEditVisualStyle(g.visual_style ?? '')
    setOrigVisualStyle(g.visual_style ?? '')
  }

  return (
    <AppShell crumbs={[{ label: 'Jeux' }]}>
      <main className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold">Jeux</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Systèmes de jeu disponibles pour vos campagnes — chacun a sa propre base de connaissances.
            </p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2 shrink-0">
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
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />Ajouter
              </Button>
            </div>
          )}
        </div>

        {importGame.isError && (
          <p className="text-xs text-destructive mt-2">{(importGame.error as Error).message}</p>
        )}

        {isLoading && <p className="text-sm text-muted-foreground mt-8">Chargement…</p>}

        {!isLoading && games.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground mt-8">
            Aucun jeu configuré.{isAdmin ? ' Ajoutez-en un pour commencer.' : ''}
          </p>
        )}

        <ul className="mt-6 divide-y">
          {games.map(g => (
            <li key={g.id} className="py-3">
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
                      className="h-8 px-2 text-xs shrink-0"
                      disabled={!editName.trim() || !editSlug.trim() || updateGame.isPending}
                      onClick={() => updateGame.mutate({ id: g.id, name: editName.trim(), slug: editSlug.trim(), genre: editGenre.trim(), description: editDescription, sheet_template_id: editSheetTemplateId || null })}
                    >
                      OK
                    </Button>
                    <button onClick={() => setEditingId(null)} className="text-muted-foreground/50 hover:text-muted-foreground shrink-0">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <Input
                    value={editGenre}
                    onChange={e => setEditGenre(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="Genre (ex : cyberpunk, fantasy, horreur…)"
                  />
                  <div className="flex items-center gap-2">
                    <Label className="text-xs text-muted-foreground shrink-0">Fiche de personnage</Label>
                    <select
                      value={editSheetTemplateId}
                      onChange={e => setEditSheetTemplateId(e.target.value)}
                      className="flex-1 text-xs rounded border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <option value="">Aucune</option>
                      {sheetTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <textarea
                    value={editDescription}
                    onChange={e => setEditDescription(e.target.value)}
                    placeholder="Description — de quoi parle ce jeu, son univers, ses règles…"
                    rows={3}
                    className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                <div className="flex items-start gap-3 group">
                  <div className="min-w-0 flex-1">
                    <button
                      className="text-sm font-medium truncate hover:underline text-left"
                      onClick={() => isAdmin ? startEdit(g) : navigate(`/lore?game=${g.id}`)}
                    >
                      {g.name}
                    </button>
                    <div className="flex items-center gap-2 mt-0.5">
                      {g.genre && <span className="text-xs text-muted-foreground">{g.genre}</span>}
                      <span className="text-xs text-muted-foreground font-mono">{g.slug}</span>
                    </div>
                    {g.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{g.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => navigate(`/lore?game=${g.id}`)}
                      title="Parcourir la base de connaissances"
                    >
                      <BookOpen className="h-3.5 w-3.5 mr-1" />
                      Connaissances
                    </Button>
                    <button
                      onClick={() => setDocsGame(g)}
                      className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground/60 hover:text-muted-foreground transition-opacity"
                      title="Voir les documents"
                    >
                      <FolderOpen className="h-3.5 w-3.5" />
                    </button>
                    {isAdmin && (
                      <>
                        <a
                          href={`/api/games/${g.id}/export`}
                          className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground/60 hover:text-muted-foreground transition-opacity"
                          title="Exporter (.zip)"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                        <button
                          onClick={() => startEdit(g)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground/60 hover:text-muted-foreground transition-opacity"
                          title="Modifier"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => { if (confirm(`Supprimer "${g.name}" ?`)) deleteGame.mutate(g.id) }}
                          className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground/60 hover:text-destructive transition-opacity"
                          title="Supprimer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        {isAdmin && adding && (
          <div className="space-y-2 mt-6 pt-6 border-t">
            <Label>Nouveau jeu</Label>
            <div className="flex items-center gap-2">
              <Input
                value={newName}
                onChange={e => { setNewName(e.target.value); setNewSlug(slugify(e.target.value)) }}
                className="h-8 text-xs"
                placeholder="Nom (ex : Donjons & Dragons)"
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
                className="h-8 px-2 text-xs shrink-0"
                disabled={!newName.trim() || !newSlug.trim() || createGame.isPending}
                onClick={() => createGame.mutate({ name: newName.trim(), slug: newSlug.trim(), genre: newGenre.trim(), description: newDescription.trim(), sheet_template_id: newSheetTemplateId || null })}
              >
                Ajouter
              </Button>
              <button
                onClick={() => { setAdding(false); setNewName(''); setNewSlug(''); setNewGenre(''); setNewDescription(''); setNewSheetTemplateId('') }}
                className="text-muted-foreground/50 hover:text-muted-foreground shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <Input
              value={newGenre}
              onChange={e => setNewGenre(e.target.value)}
              className="h-8 text-xs"
              placeholder="Genre (ex : fantasy, cyberpunk, horreur…)"
            />
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground shrink-0">Fiche de personnage</Label>
              <select
                value={newSheetTemplateId}
                onChange={e => setNewSheetTemplateId(e.target.value)}
                className="flex-1 text-xs rounded border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Aucune</option>
                {sheetTemplates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <textarea
              value={newDescription}
              onChange={e => setNewDescription(e.target.value)}
              placeholder="Description — de quoi parle ce jeu, son univers, ses règles…"
              rows={3}
              className="w-full resize-none rounded-md border border-input bg-transparent px-3 py-2 text-xs shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {createGame.isError && (
              <p className="text-xs text-destructive">{(createGame.error as Error).message}</p>
            )}
          </div>
        )}
      </main>

      {docsGame && (
        <GameDocumentsDialog game={docsGame} onClose={() => setDocsGame(null)} />
      )}
    </AppShell>
  )
}
