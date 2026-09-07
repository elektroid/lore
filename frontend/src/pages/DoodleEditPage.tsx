import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Lock, Plus, Trash2, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import AppShell from '@/components/AppShell'
import DoodleResultsGrid from '@/components/doodle/DoodleResultsGrid'
import { api } from '@/api/client'
import { useDocTitle } from '@/hooks/useDocTitle'
import type { DoodleDetail } from '@/types/doodle'
import { shareUrl } from '@/types/doodle'

export default function DoodleEditPage() {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['doodle', id],
    queryFn: () => api.get<DoodleDetail>(`/doodles/${id}`),
  })

  useDocTitle(data ? `lore: ${data.doodle.title}` : 'lore: sondage')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [newSlot, setNewSlot] = useState('')
  const [copied, setCopied] = useState(false)
  const loaded = useRef(false)

  useEffect(() => {
    if (data && !loaded.current) {
      setTitle(data.doodle.title)
      setDescription(data.doodle.description)
      loaded.current = true
    }
  }, [data])

  function onSuccess(detail: DoodleDetail) {
    qc.setQueryData(['doodle', id], detail)
    qc.invalidateQueries({ queryKey: ['doodles'] })
  }

  const save = useMutation({
    mutationFn: () => api.put<DoodleDetail>(`/doodles/${id}`, {
      title, description, closed: data?.doodle.closed ?? false,
    }),
    onSuccess,
  })

  const toggleClosed = useMutation({
    mutationFn: () => api.put<DoodleDetail>(`/doodles/${id}`, {
      title, description, closed: !(data?.doodle.closed ?? false),
    }),
    onSuccess,
  })

  const addSlot = useMutation({
    mutationFn: (startsAt: string) => api.post<DoodleDetail>(`/doodles/${id}/slots`, { starts_at: startsAt }),
    onSuccess: (detail) => { onSuccess(detail); setNewSlot('') },
  })

  const deleteSlot = useMutation({
    mutationFn: (slotId: string) => api.delete<DoodleDetail>(`/doodles/${id}/slots/${slotId}`),
    onSuccess,
  })

  const deleteDoodle = useMutation({
    mutationFn: () => api.delete(`/doodles/${id}`),
    onSuccess: () => navigate('/doodles'),
  })

  if (isLoading || !data) {
    return (
      <AppShell crumbs={[{ label: 'Sondages', to: '/doodles' }]}>
        <main className="max-w-2xl mx-auto px-6 py-10">
          <p className="text-sm text-muted-foreground">Chargement…</p>
        </main>
      </AppShell>
    )
  }

  const { doodle, slots, respondents } = data
  const titleDirty = title !== doodle.title || description !== doodle.description

  function copyLink() {
    navigator.clipboard.writeText(shareUrl(doodle)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <AppShell crumbs={[{ label: 'Sondages', to: '/doodles' }, { label: doodle.title }]}>
      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        <div className="space-y-3">
          <Label htmlFor="doodle-title">Titre</Label>
          <Input id="doodle-title" value={title} onChange={e => setTitle(e.target.value)} className="text-base font-medium" />
          <Label htmlFor="doodle-description">Description (facultatif)</Label>
          <Textarea id="doodle-description" value={description} onChange={e => setDescription(e.target.value)} rows={2} />
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!titleDirty || !title.trim() || save.isPending} onClick={() => save.mutate()}>
              Enregistrer
            </Button>
            <Button size="sm" variant="outline" onClick={() => toggleClosed.mutate()} disabled={toggleClosed.isPending}>
              {doodle.closed ? <><Unlock className="h-3.5 w-3.5 mr-1" />Rouvrir</> : <><Lock className="h-3.5 w-3.5 mr-1" />Clore</>}
            </Button>
            <button
              onClick={() => { if (confirm(`Supprimer le sondage "${doodle.title}" ?`)) deleteDoodle.mutate() }}
              className="ml-auto text-muted-foreground/60 hover:text-destructive p-1.5"
              title="Supprimer"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-3 flex items-center gap-2">
          <p className="text-xs text-muted-foreground flex-1 truncate font-mono">{shareUrl(doodle)}</p>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs shrink-0" onClick={copyLink}>
            {copied ? <><Check className="h-3.5 w-3.5 mr-1" />Copié</> : <><Copy className="h-3.5 w-3.5 mr-1" />Copier le lien</>}
          </Button>
        </div>
        {doodle.closed && (
          <p className="text-xs text-amber-600 -mt-4">Ce sondage est clos : le lien reste consultable mais n'accepte plus de nouvelles réponses.</p>
        )}

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Créneaux proposés</h2>
          <ul className="space-y-1.5">
            {slots.map(s => (
              <li key={s.id} className="flex items-center gap-2 group">
                <span className="text-sm flex-1">
                  {/* timeZone: 'UTC' — see DoodleResultsGrid's formatSlot */}
                  {new Date(s.starts_at).toLocaleString('fr-FR', {
                    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
                  })}
                </span>
                <button
                  onClick={() => deleteSlot.mutate(s.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground/60 hover:text-destructive transition-opacity"
                  title="Retirer ce créneau"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
            {slots.length === 0 && <p className="text-sm text-muted-foreground">Aucun créneau pour l'instant.</p>}
          </ul>
          <div className="flex items-center gap-2 pt-2">
            <input
              type="datetime-local"
              value={newSlot}
              onChange={e => setNewSlot(e.target.value)}
              className="h-8 text-xs rounded border border-input bg-background px-2"
            />
            <Button
              size="sm"
              className="h-8 px-2 text-xs"
              disabled={!newSlot || addSlot.isPending}
              onClick={() => addSlot.mutate(newSlot)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" />Ajouter
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Réponses</h2>
          <DoodleResultsGrid slots={slots} respondents={respondents} />
        </section>
      </main>
    </AppShell>
  )
}
