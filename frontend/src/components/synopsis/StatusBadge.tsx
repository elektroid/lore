import { cn } from '@/lib/utils'
import type { ItemStatus } from '@/types/synopsis'

const CYCLE: ItemStatus[] = ['draft', 'in_progress', 'confirmed']
const LABEL: Record<ItemStatus, string> = { draft: '💡', in_progress: '✓', confirmed: '🔒' }
const COLOR: Record<ItemStatus, string> = {
  draft: 'text-yellow-600 border-yellow-300 bg-yellow-50 hover:bg-yellow-100',
  in_progress: 'text-blue-600 border-blue-300 bg-blue-50 hover:bg-blue-100',
  confirmed: 'text-green-700 border-green-300 bg-green-50 hover:bg-green-100',
}

interface Props {
  status: ItemStatus
  onChange: (s: ItemStatus) => void
  disabled?: boolean
}

export default function StatusBadge({ status, onChange, disabled }: Props) {
  function cycle() {
    if (disabled) return
    const next = CYCLE[(CYCLE.indexOf(status) + 1) % CYCLE.length]
    onChange(next)
  }
  return (
    <button
      type="button"
      onClick={cycle}
      title={status === 'confirmed' ? 'Verrouillé' : 'Changer le statut'}
      className={cn(
        'inline-flex items-center justify-center w-7 h-7 rounded border text-sm shrink-0 transition-colors',
        COLOR[status],
        disabled && 'opacity-50 cursor-default',
      )}
    >
      {LABEL[status]}
    </button>
  )
}
