import { X } from 'lucide-react'
import { useToastStore } from '@/stores/toast'
import { cn } from '@/lib/utils'

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts)
  const dismiss = useToastStore((s) => s.dismiss)

  if (toasts.length === 0) return null

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={cn(
            'flex items-start gap-2 rounded-md border px-4 py-3 text-sm shadow-lg',
            t.variant === 'error'
              ? 'border-destructive/50 bg-destructive text-destructive-foreground'
              : 'border-border bg-background text-foreground'
          )}
        >
          <p className="flex-1 leading-snug">{t.message}</p>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 opacity-70 hover:opacity-100"
            aria-label="Fermer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
