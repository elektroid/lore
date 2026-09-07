import { useState } from 'react'

const MONTH_COUNTS = [1, 3, 6, 12] as const
type MonthCount = (typeof MONTH_COUNTS)[number]

const WEEKDAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function todayISO(): string {
  return toISODate(new Date())
}

// Monday-first column index for a JS day-of-week (0=Sunday..6=Saturday).
function mondayIndex(jsDay: number): number {
  return (jsDay + 6) % 7
}

function Month({ year, month, selected, onToggle, minDate }: {
  year: number
  month: number
  selected: Set<string>
  onToggle: (date: string) => void
  minDate: string
}) {
  const first = new Date(year, month, 1)
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const leadingBlanks = mondayIndex(first.getDay())
  const cells: (number | null)[] = [...Array(leadingBlanks).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  return (
    <div className="border rounded-lg p-3">
      <p className="text-sm font-medium mb-2 capitalize">
        {first.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}
      </p>
      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAY_LABELS.map(w => (
          <span key={w} className="text-[10px] text-muted-foreground/60 font-medium">{w}</span>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <span key={`b${i}`} />
          const date = `${year}-${pad(month + 1)}-${pad(day)}`
          const isPast = date < minDate
          const isSelected = selected.has(date)
          return (
            <button
              key={date}
              type="button"
              disabled={isPast}
              onClick={() => onToggle(date)}
              className={`text-xs h-7 w-7 mx-auto rounded-full transition-colors ${
                isPast
                  ? 'text-muted-foreground/25 cursor-not-allowed'
                  : isSelected
                    ? 'bg-primary text-primary-foreground font-medium'
                    : 'hover:bg-accent text-foreground'
              }`}
            >
              {day}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * A multi-month click-to-toggle calendar for proposing whole-day slots — no
 * time of day, per the GM's own scheduling need. Shows 1/3/6/12 months
 * forward from today at once; clicking a day toggles it, the caller decides
 * what a toggle means (add/remove a doodle slot).
 */
export default function DoodleCalendarPicker({ selected, onToggle }: {
  selected: Set<string>
  onToggle: (date: string) => void
}) {
  const [monthCount, setMonthCount] = useState<MonthCount>(3)
  const min = todayISO()
  const now = new Date()

  const months = Array.from({ length: monthCount }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    return { year: d.getFullYear(), month: d.getMonth() }
  })

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        {MONTH_COUNTS.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setMonthCount(c)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
              monthCount === c ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:bg-accent'
            }`}
          >
            {c} mois
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {months.map(({ year, month }) => (
          <Month key={`${year}-${month}`} year={year} month={month} selected={selected} onToggle={onToggle} minDate={min} />
        ))}
      </div>
    </div>
  )
}
