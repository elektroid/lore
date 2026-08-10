import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, Copy, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import AppShell from '@/components/AppShell'
import { api } from '@/api/client'
import { useUser } from '@/stores/auth'
import { useDocTitle } from '@/hooks/useDocTitle'
import type { SheetTemplate } from '@/types/sheetTemplate'
import { EMPTY_SCHEMA } from '@/types/sheetTemplate'

export default function SheetTemplatesPage() {
  useDocTitle('lore: fiches de personnage')
  const navigate = useNavigate()
  const isAdmin = useUser()?.role === 'superuser'
  const qc = useQueryClient()

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['sheet-templates'],
    queryFn: () => api.get<SheetTemplate[]>('/sheet-templates'),
  })

  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  const createTemplate = useMutation({
    mutationFn: (name: string) => api.post<SheetTemplate>('/sheet-templates', { name, schema: JSON.stringify(EMPTY_SCHEMA) }),
    onSuccess: (tmpl) => {
      qc.invalidateQueries({ queryKey: ['sheet-templates'] })
      setAdding(false)
      setNewName('')
      navigate(`/sheet-templates/${tmpl.id}`)
    },
  })

  const duplicateTemplate = useMutation({
    mutationFn: (tmpl: SheetTemplate) => api.post<SheetTemplate>('/sheet-templates', { name: `${tmpl.name} (copie)`, schema: tmpl.schema }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sheet-templates'] }),
  })

  const deleteTemplate = useMutation({
    mutationFn: (id: string) => api.delete(`/sheet-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sheet-templates'] }),
  })

  return (
    <AppShell crumbs={[{ label: 'Fiches de personnage' }]}>
      <main className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold">Fiches de personnage</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Modèles réutilisables de fiche — STATs, compétences, valeurs calculées.
              Un jeu s'associe à l'un d'eux ; plusieurs jeux peuvent partager le même.
            </p>
          </div>
          {isAdmin && (
            <Button size="sm" className="shrink-0" onClick={() => setAdding(true)}>
              <Plus className="h-3.5 w-3.5 mr-1" />Ajouter
            </Button>
          )}
        </div>

        {isLoading && <p className="text-sm text-muted-foreground mt-8">Chargement…</p>}

        {!isLoading && templates.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground mt-8">
            Aucune fiche configurée.{isAdmin ? ' Ajoutez-en une pour commencer.' : ''}
          </p>
        )}

        <ul className="mt-6 divide-y">
          {templates.map(t => (
            <li key={t.id} className="py-3 flex items-center gap-3 group">
              <button
                className="text-sm font-medium truncate hover:underline text-left flex-1"
                onClick={() => navigate(`/sheet-templates/${t.id}`)}
              >
                {t.name}
              </button>
              {isAdmin && (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => duplicateTemplate.mutate(t)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground/60 hover:text-muted-foreground transition-opacity"
                    title="Dupliquer"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => navigate(`/sheet-templates/${t.id}`)}
                    className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground/60 hover:text-muted-foreground transition-opacity"
                    title="Modifier"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => { if (confirm(`Supprimer "${t.name}" ?`)) deleteTemplate.mutate(t.id) }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground/60 hover:text-destructive transition-opacity"
                    title="Supprimer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>

        {isAdmin && adding && (
          <div className="flex items-center gap-2 mt-6 pt-6 border-t">
            <Input
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="h-8 text-xs"
              placeholder="Nom (ex : Cyberpunk RED)"
              autoFocus
            />
            <Button
              size="sm"
              className="h-8 px-2 text-xs shrink-0"
              disabled={!newName.trim() || createTemplate.isPending}
              onClick={() => createTemplate.mutate(newName.trim())}
            >
              Ajouter
            </Button>
            <button onClick={() => { setAdding(false); setNewName('') }} className="text-muted-foreground/50 hover:text-muted-foreground shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </main>
    </AppShell>
  )
}
