import type { DoodleAnswer } from '@/types/doodle'

const OPTIONS: { value: DoodleAnswer; label: string; active: string }[] = [
  { value: 'yes', label: 'Oui', active: 'bg-emerald-600 text-white border-emerald-600' },
  { value: 'maybe', label: 'Peut-être', active: 'bg-amber-500 text-white border-amber-500' },
  { value: 'no', label: 'Non', active: 'bg-muted-foreground text-background border-muted-foreground' },
]

export default function DoodleAnswerPicker({ value, onChange }: {
  value: DoodleAnswer | undefined
  onChange: (v: DoodleAnswer) => void
}) {
  return (
    <div className="flex gap-1.5">
      {OPTIONS.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
            value === o.value ? o.active : 'border-input text-muted-foreground hover:bg-accent'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
