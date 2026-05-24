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

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleConfirm() {
    onConfirm([...selected])
    setSelected(new Set())
  }

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
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
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Annuler</Button>
          <Button onClick={handleConfirm} disabled={selected.size === 0}>
            Conserver {selected.size > 0 ? `(${selected.size})` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
