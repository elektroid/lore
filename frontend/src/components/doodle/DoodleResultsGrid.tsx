import { Check, X, HelpCircle } from 'lucide-react'
import type { DoodleAnswer, DoodleRespondentVotes, DoodleSlot } from '@/types/doodle'

// Slots are whole days (see DoodleCalendarPicker), stored at midnight.
// starts_at round-trips through a sqlite DATETIME column that the driver
// normalizes to RFC3339 with a trailing Z — relabeling the naive date as
// UTC midnight, not converting it. timeZone: 'UTC' here cancels that
// relabeling back out instead of letting the viewer's own offset roll the
// date to the day before or after.
function formatSlot(startsAt: string): string {
  const d = new Date(startsAt)
  if (Number.isNaN(d.getTime())) return startsAt
  return d.toLocaleDateString('fr-FR', {
    weekday: 'short', day: '2-digit', month: 'short', timeZone: 'UTC',
  })
}

const ANSWER_ICON: Record<DoodleAnswer, React.ReactNode> = {
  yes: <Check className="h-3.5 w-3.5 text-emerald-600" />,
  no: <X className="h-3.5 w-3.5 text-muted-foreground/40" />,
  maybe: <HelpCircle className="h-3.5 w-3.5 text-amber-500" />,
}

/**
 * Shared by the GM's management view and the public voting page — rows are
 * respondents, columns are slots, the last row tallies "yes" answers per
 * slot so the best date pops out without anyone doing the counting.
 */
export default function DoodleResultsGrid({ slots, respondents }: {
  slots: DoodleSlot[]
  respondents: DoodleRespondentVotes[]
}) {
  if (slots.length === 0) {
    return <p className="text-sm text-muted-foreground">Aucun créneau proposé pour l'instant.</p>
  }

  const yesCounts = slots.map(s => respondents.filter(r => r.votes[s.id] === 'yes').length)
  const maxYes = Math.max(0, ...yesCounts)

  return (
    <div className="overflow-x-auto">
      <table className="text-sm border-collapse w-full">
        <thead>
          <tr>
            <th className="text-left font-medium text-muted-foreground p-2 sticky left-0 bg-background">Participant·e</th>
            {slots.map(s => (
              <th key={s.id} className="text-center font-medium text-muted-foreground p-2 whitespace-nowrap">
                {formatSlot(s.starts_at)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {respondents.length === 0 && (
            <tr>
              <td colSpan={slots.length + 1} className="text-center text-muted-foreground p-4">
                Personne n'a encore répondu.
              </td>
            </tr>
          )}
          {respondents.map(r => (
            <tr key={r.id} className="border-t">
              <td className="p-2 font-medium sticky left-0 bg-background">{r.name}</td>
              {slots.map(s => (
                <td key={s.id} className="text-center p-2">
                  <span className="inline-flex items-center justify-center">
                    {r.votes[s.id] ? ANSWER_ICON[r.votes[s.id]] : <span className="text-muted-foreground/30">—</span>}
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {respondents.length > 0 && (
          <tfoot>
            <tr className="border-t-2">
              <td className="p-2 font-medium text-muted-foreground sticky left-0 bg-background">Oui</td>
              {slots.map((s, i) => (
                <td key={s.id} className={`text-center p-2 font-semibold ${yesCounts[i] === maxYes && maxYes > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                  {yesCounts[i]}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
