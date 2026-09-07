import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, Lock, Trash2, Unlock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import AppShell from '@/components/AppShell'
import DoodleResultsGrid from '@/components/doodle/DoodleResultsGrid'
import DoodleCalendarPicker from '@/components/doodle/DoodleCalendarPicker'
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
    mutationFn: (date: string) => api.post<DoodleDetail>(`/doodles/${id}/slots`, { starts_at: date }),
    onSuccess,
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
          <h2 className="text-sm font-semibold">Jours proposés</h2>
          <p className="text-xs text-muted-foreground -mt-2">Cliquez sur un jour pour le proposer, cliquez à nouveau pour le retirer.</p>

          {slots.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {[...slots].sort((a, b) => a.starts_at.localeCompare(b.starts_at)).map(s => (
                <li key={s.id} className="flex items-center gap-1 text-xs rounded-full border bg-card pl-2.5 pr-1 py-1">
                  {/* timeZone: 'UTC' — see DoodleResultsGrid's formatSlot */}
                  {new Date(s.starts_at).toLocaleDateString('fr-FR', {
                    weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC',
                  })}
                  <button
                    onClick={() => deleteSlot.mutate(s.id)}
                    className="p-0.5 text-muted-foreground/60 hover:text-destructive"
                    title="Retirer ce jour"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <DoodleCalendarPicker
            selected={new Set(slots.map(s => s.starts_at.slice(0, 10)))}
            onToggle={(date) => {
              const existing = slots.find(s => s.starts_at.slice(0, 10) === date)
              if (existing) deleteSlot.mutate(existing.id)
              else addSlot.mutate(date)
            }}
          />
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold">Réponses</h2>
          <DoodleResultsGrid slots={slots} respondents={respondents} />
        </section>
      </main>
    </AppShell>
  )
}
