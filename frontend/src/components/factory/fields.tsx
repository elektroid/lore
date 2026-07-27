import { useEffect, useRef } from 'react'

/** Textarea that grows with its content — same behaviour as the entity editors,
 *  kept local to the factory so the review screen reads as one piece. */
export function AutoTextarea({
  value, onChange, placeholder, rows = 2, className = '', disabled,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  rows?: number
  className?: string
  disabled?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [value])
  return (
    <textarea
      ref={ref}
      rows={rows}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={e => onChange(e.target.value)}
      className={`w-full resize-none overflow-hidden rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 ${className}`}
    />
  )
}

/** The include tick. Unticking is the GM's veto: the item stays in the draft,
 *  readable, but never reaches the campaign. */
export function IncludeToggle({ checked, onChange, label }: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={e => onChange(e.target.checked)}
      onClick={e => e.stopPropagation()}
      title={label ?? (checked ? 'Retirer du scénario' : 'Remettre dans le scénario')}
      className="h-3.5 w-3.5 rounded shrink-0 accent-primary cursor-pointer"
    />
  )
}

export function FieldLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{children}</p>
}
