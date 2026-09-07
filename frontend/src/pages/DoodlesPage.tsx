import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import AppShell from '@/components/AppShell'
import { api } from '@/api/client'
import { useDocTitle } from '@/hooks/useDocTitle'
import type { Doodle, DoodleDetail } from '@/types/doodle'

export default function DoodlesPage() {
  useDocTitle('lore: sondages')
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: doodles = [], isLoading } = useQuery({
    queryKey: ['doodles'],
    queryFn: () => api.get<Doodle[]>('/doodles'),
  })

  const [adding, setAdding] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const createDoodle = useMutation({
    mutationFn: (title: string) => api.post<DoodleDetail>('/doodles', { title }),
    onSuccess: ({ doodle }) => {
      qc.invalidateQueries({ queryKey: ['doodles'] })
      setAdding(false)
      setNewTitle('')
      navigate(`/doodles/${doodle.id}`)
    },
  })

  const deleteDoodle = useMutation({
    mutationFn: (id: string) => api.delete(`/doodles/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['doodles'] }),
  })

  return (
    <AppShell crumbs={[{ label: 'Sondages' }]}>
      <main className="max-w-2xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold">Sondages</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Proposez des créneaux, partagez le lien, trouvez la date qui convient à tout le monde —
              sans lier le sondage à une campagne ou un groupe.
            </p>
          </div>
          <Button size="sm" className="shrink-0" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" />Nouveau
          </Button>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground mt-8">Chargement…</p>}

        {!isLoading && doodles.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground mt-8">
            Aucun sondage pour l'instant. Créez-en un pour proposer des dates à votre table.
          </p>
        )}

        <ul className="mt-6 divide-y">
          {doodles.map(d => (
            <li key={d.id} className="py-3 flex items-center gap-3 group">
              <button
                className="text-sm font-medium truncate hover:underline text-left flex-1"
                onClick={() => navigate(`/doodles/${d.id}`)}
              >
                {d.title}
                {d.closed && <span className="ml-2 text-xs text-muted-foreground font-normal">(clos)</span>}
              </button>
              <button
                onClick={() => { if (confirm(`Supprimer le sondage "${d.title}" ?`)) deleteDoodle.mutate(d.id) }}
                className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground/60 hover:text-destructive transition-opacity shrink-0"
                title="Supprimer"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>

        {adding && (
          <div className="flex items-center gap-2 mt-6 pt-6 border-t">
            <Input
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              className="h-8 text-xs"
              placeholder="Titre (ex : Prochaine séance)"
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && newTitle.trim()) createDoodle.mutate(newTitle.trim()) }}
            />
            <Button
              size="sm"
              className="h-8 px-2 text-xs shrink-0"
              disabled={!newTitle.trim() || createDoodle.isPending}
              onClick={() => createDoodle.mutate(newTitle.trim())}
            >
              Créer
            </Button>
            <button onClick={() => { setAdding(false); setNewTitle('') }} className="text-muted-foreground/50 hover:text-muted-foreground shrink-0">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </main>
    </AppShell>
  )
}
