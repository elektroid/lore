import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import type { PendingImage } from '@/types/entities'

export default function ImageCandidatePicker({
  candidates, open, onConfirm, onClose,
}: {
  candidates: PendingImage[]
  open: boolean
  onConfirm: (selected: string[]) => void
  onClose: () => void
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Generated images only exist server-side until they are confirmed, so a
  // stray click must not discard them — closing asks first.
  const [confirmingDiscard, setConfirmingDiscard] = useState(false)

  // Each opening starts from a clean slate — reset while rendering rather than
  // in an effect, so the first paint already shows the fresh state.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) { setSelected(new Set()); setConfirmingDiscard(false) }
  }

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  function handleConfirm() {
    onConfirm([...selected])
    setSelected(new Set())
  }

  function requestClose() {
    if (candidates.length === 0 || confirmingDiscard) { onClose(); return }
    setConfirmingDiscard(true)
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && requestClose()}>
      <DialogContent
        className="max-w-2xl max-h-[80vh] overflow-y-auto"
        // Clicking beside the dialog is the accident we are guarding against:
        // ignore it outright rather than arming the discard prompt.
        onInteractOutside={e => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Choisir les illustrations à conserver</DialogTitle>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">Aucune illustration générée.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {candidates.map(img => (
              <button
                key={img.id}
                onClick={() => toggle(img.id)}
                className={`relative rounded-lg overflow-hidden border-2 transition-colors ${
                  selected.has(img.id) ? 'border-primary' : 'border-transparent'
                }`}
              >
                <img src={img.url} alt="illustration" className="w-full aspect-square object-cover" />
                {selected.has(img.id) && (
                  <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                    <div className="bg-primary text-primary-foreground rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">✓</div>
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
        {confirmingDiscard && (
          <p className="text-xs text-destructive">
            Les illustrations générées seront définitivement perdues — il faudra les régénérer.
          </p>
        )}
        <DialogFooter>
          {confirmingDiscard ? (
            <>
              <Button variant="outline" onClick={() => setConfirmingDiscard(false)}>Revenir</Button>
              <Button variant="destructive" onClick={onClose}>Abandonner les illustrations</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={requestClose}>Annuler</Button>
              <Button onClick={handleConfirm} disabled={selected.size === 0}>
                Conserver {selected.size > 0 ? `(${selected.size})` : ''}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
