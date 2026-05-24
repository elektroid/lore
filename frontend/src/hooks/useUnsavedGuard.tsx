import { useEffect, useState } from 'react'
import { useBlocker } from 'react-router-dom'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

export function useUnsavedGuard(isDirty: boolean, onSave?: () => Promise<void>) {
  const blocker = useBlocker(isDirty)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  async function handleSave() {
    if (!onSave) return
    setSaving(true)
    try {
      await onSave()
      blocker.proceed?.()
    } catch {
      // save failed — stay on page
    } finally {
      setSaving(false)
    }
  }

  const guardDialog = (
    <Dialog
      open={blocker.state === 'blocked'}
      onOpenChange={open => { if (!open) blocker.reset?.() }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Modifications non sauvegardées</DialogTitle>
          <DialogDescription>
            Vos modifications seront perdues si vous quittez cette page.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => blocker.proceed?.()}>
            Perdre les modifications
          </Button>
          {onSave && (
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Sauvegarde…' : 'Sauvegarder'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  return { guardDialog }
}
