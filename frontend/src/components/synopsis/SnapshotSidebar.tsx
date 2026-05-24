import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, GitCompare } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import SnapshotDiff from './SnapshotDiff'
import { api } from '@/api/client'
import type { Snapshot, Synopsis, SynopsisData } from '@/types/synopsis'

interface Props {
  scenarioId: string
  current: SynopsisData | null
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function SnapshotSidebar({ scenarioId, current }: Props) {
  const queryClient = useQueryClient()
  const [diffSnapshot, setDiffSnapshot] = useState<Snapshot | null>(null)

  const { data: snapshots } = useQuery({
    queryKey: ['snapshots', scenarioId],
    queryFn: () => api.get<Snapshot[]>(`/scenarios/${scenarioId}/synopsis/snapshots`),
  })

  const restore = useMutation({
    mutationFn: (snapshotId: string) =>
      api.post<Synopsis>(`/scenarios/${scenarioId}/synopsis/restore/${snapshotId}`, {}),
    onSuccess: (updated) => {
      queryClient.setQueryData(['synopsis', scenarioId], updated)
      queryClient.invalidateQueries({ queryKey: ['snapshots', scenarioId] })
      setDiffSnapshot(null)
    },
  })

  return (
    <>
      <aside className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1">
          Historique
        </p>

        {(!snapshots || snapshots.length === 0) && (
          <p className="text-xs text-muted-foreground px-1">
            Aucun snapshot — les actions LLM en créeront automatiquement.
          </p>
        )}

        <ul className="space-y-1">
          {snapshots?.map(snap => (
            <li key={snap.id} className="rounded border bg-card p-2 text-xs space-y-1.5">
              <p className="font-medium leading-snug">{snap.label}</p>
              <p className="text-muted-foreground">{formatDate(snap.created_at)}</p>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-xs flex-1"
                  onClick={() => setDiffSnapshot(snap)}
                  disabled={!current}
                >
                  <GitCompare className="h-3 w-3 mr-0.5" />
                  Diff
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-xs flex-1"
                  disabled={restore.isPending}
                  onClick={() => restore.mutate(snap.id)}
                >
                  <RotateCcw className="h-3 w-3 mr-0.5" />
                  Restaurer
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </aside>

      <Dialog open={!!diffSnapshot} onOpenChange={open => !open && setDiffSnapshot(null)}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Diff — {diffSnapshot?.label}</DialogTitle>
          </DialogHeader>
          {diffSnapshot && current && (
            <SnapshotDiff snapshot={diffSnapshot} current={current} />
          )}
          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDiffSnapshot(null)}>Fermer</Button>
            {diffSnapshot && (
              <Button
                variant="destructive"
                disabled={restore.isPending}
                onClick={() => restore.mutate(diffSnapshot.id)}
              >
                {restore.isPending ? 'Restauration…' : 'Restaurer ce snapshot'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
