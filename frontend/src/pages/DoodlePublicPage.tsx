import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import DoodleResultsGrid from '@/components/doodle/DoodleResultsGrid'
import DoodleAnswerPicker from '@/components/doodle/DoodleAnswerPicker'
import { api } from '@/api/client'
import { useDocTitle } from '@/hooks/useDocTitle'
import type { DoodleAnswer, PublicDoodleDetail } from '@/types/doodle'

// Slots are whole days — see DoodleResultsGrid's formatSlot for why
// timeZone: 'UTC' belongs here.
function formatSlotLong(startsAt: string): string {
  const d = new Date(startsAt)
  if (Number.isNaN(d.getTime())) return startsAt
  return d.toLocaleDateString('fr-FR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

/**
 * The public share link: no login, no CSRF (see isPublicEndpoint), just the
 * token in the URL. Anyone holding the link can view the current results
 * and add or update their own answers by name.
 */
export default function DoodlePublicPage() {
  const { token = '' } = useParams<{ token: string }>()
  const qc = useQueryClient()

  const { data, isLoading, error } = useQuery({
    queryKey: ['doodle-public', token],
    queryFn: () => api.get<PublicDoodleDetail>(`/doodles/share/${token}`),
    retry: false,
  })

  useDocTitle(data ? `lore: ${data.title}` : 'lore: sondage')

  const [name, setName] = useState('')
  const [answers, setAnswers] = useState<Record<string, DoodleAnswer>>({})
  const [submitted, setSubmitted] = useState(false)

  // Pre-fill the form when this name has already answered, so re-opening
  // the link to change an answer starts from what was submitted before —
  // checked once the visitor finishes typing their name, not on every
  // keystroke.
  function prefillFromExisting() {
    if (!data || !name.trim()) return
    const existing = data.respondents.find(r => r.name.toLowerCase() === name.trim().toLowerCase())
    if (existing) setAnswers(existing.votes)
  }

  const submit = useMutation({
    mutationFn: () => api.post(`/doodles/share/${token}/votes`, { name: name.trim(), answers }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['doodle-public', token] })
      setSubmitted(true)
      setTimeout(() => setSubmitted(false), 2000)
    },
  })

  if (isLoading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">Chargement…</div>
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-2 px-6 text-center">
        <p className="text-lg">Ce lien de sondage n'est plus valide.</p>
        <p className="text-sm text-muted-foreground">Demandez au meneur de vous renvoyer le lien.</p>
      </div>
    )
  }

  const allAnswered = data.slots.length > 0 && data.slots.every(s => answers[s.id])

  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-2xl mx-auto px-6 py-10 space-y-8">
        <div>
          <h1 className="text-2xl font-bold">{data.title}</h1>
          {data.description && <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{data.description}</p>}
        </div>

        {data.closed ? (
          <p className="text-sm rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-700 px-3 py-2">
            Ce sondage est clos, il n'accepte plus de nouvelles réponses.
          </p>
        ) : data.slots.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun créneau proposé pour l'instant.</p>
        ) : (
          <section className="space-y-4">
            <div>
              <label className="text-sm font-medium">Votre nom</label>
              <Input value={name} onChange={e => setName(e.target.value)} onBlur={prefillFromExisting} placeholder="Comment vous appelez-vous ?" className="mt-1" maxLength={80} />
            </div>
            <ul className="space-y-2">
              {data.slots.map(s => (
                <li key={s.id} className="flex items-center justify-between gap-3 border rounded-md p-2.5">
                  <span className="text-sm">{formatSlotLong(s.starts_at)}</span>
                  <DoodleAnswerPicker value={answers[s.id]} onChange={v => setAnswers(a => ({ ...a, [s.id]: v }))} />
                </li>
              ))}
            </ul>
            <Button
              disabled={!name.trim() || !allAnswered || submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submitted ? <><Check className="h-4 w-4 mr-1" />Envoyé</> : 'Envoyer mes réponses'}
            </Button>
          </section>
        )}

        <section className="space-y-3 pt-4 border-t">
          <h2 className="text-sm font-semibold">Réponses de tout le monde</h2>
          <DoodleResultsGrid slots={data.slots} respondents={data.respondents} />
        </section>
      </main>
    </div>
  )
}
