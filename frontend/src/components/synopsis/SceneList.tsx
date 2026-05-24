import { useRef, useState } from 'react'
import { Plus, GripVertical, Trash2, Sparkles, SeparatorHorizontal, Play, Flag } from 'lucide-react'
import {
  DndContext, closestCenter, PointerSensor, KeyboardSensor,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useSynopsisLLM } from '@/hooks/useSynopsisLLM'
import type { Scene, SceneStatus } from '@/types/synopsis'
import { api } from '@/api/client'

interface Props {
  scenarioId: string
  selectedId: string | null
  onSelect: (id: string) => void
}

// ── Status dot ────────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<SceneStatus, string> = {
  idea: 'bg-muted-foreground/40',
  optional_step: 'bg-amber-400',
  key_event: 'bg-primary',
}

function StatusDot({ status }: { status: SceneStatus }) {
  return <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_COLORS[status] ?? STATUS_COLORS.idea}`} />
}

// ── Sortable row ──────────────────────────────────────────────────────────────

function SceneRow({
  scene,
  selected,
  onSelect,
  onDelete,
  onTogglePlayed,
}: {
  scene: Scene
  selected: boolean
  onSelect: () => void
  onDelete: () => void
  onTogglePlayed: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: scene.id })

  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }

  if (scene.type === 'divider') {
    return (
      <li ref={setNodeRef} style={style} className="flex items-center gap-2 py-1">
        <button type="button" className="text-muted-foreground/50 cursor-grab" {...attributes} {...listeners}>
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
        {scene.title && <span className="text-xs text-muted-foreground/60 shrink-0">{scene.title}</span>}
        <div className="flex-1 border-t border-dashed border-muted-foreground/30" />
        <button
          type="button"
          onClick={onDelete}
          className="text-muted-foreground/40 hover:text-destructive transition-colors"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </li>
    )
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      onClick={onSelect}
      className={`flex items-center gap-2 rounded-md border px-2 py-2 cursor-pointer transition-colors ${
        selected
          ? 'bg-accent border-accent-foreground/20 text-accent-foreground'
          : scene.played
            ? 'bg-muted/40 border-transparent text-muted-foreground'
            : 'bg-card border-border hover:bg-accent/50'
      }`}
    >
      <button
        type="button"
        className="text-muted-foreground/50 hover:text-muted-foreground cursor-grab active:cursor-grabbing shrink-0"
        onClick={e => e.stopPropagation()}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>

      <input
        type="checkbox"
        checked={scene.played}
        onChange={e => { e.stopPropagation(); onTogglePlayed() }}
        onClick={e => e.stopPropagation()}
        className="h-3.5 w-3.5 rounded shrink-0 accent-primary cursor-pointer"
      />

      <span className={`flex-1 text-sm truncate ${scene.played ? 'line-through' : ''}`}>
        {scene.title || <span className="text-muted-foreground italic">Sans titre</span>}
      </span>
      {scene.is_start && <span title="Scène de départ"><Play className="h-3 w-3 shrink-0 text-emerald-600" /></span>}
      {scene.is_end && <span title="Scène de fin"><Flag className="h-3 w-3 shrink-0 text-rose-500" /></span>}
      <StatusDot status={scene.status} />

      {scene.location_name && (
        <span className="text-xs text-muted-foreground shrink-0 truncate max-w-[80px]">{scene.location_name}</span>
      )}

      <button
        type="button"
        onClick={e => { e.stopPropagation(); onDelete() }}
        className="text-muted-foreground/40 hover:text-destructive transition-colors shrink-0"
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </li>
  )
}

// ── Widget ────────────────────────────────────────────────────────────────────

export default function SceneList({ scenarioId, selectedId, onSelect }: Props) {
  const qc = useQueryClient()
  const llm = useSynopsisLLM(scenarioId)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const { data: scenes = [] } = useQuery({
    queryKey: ['scenes', scenarioId],
    queryFn: () => api.get<Scene[]>(`/scenarios/${scenarioId}/synopsis/scenes`),
  })

  const createScene = useMutation({
    mutationFn: (type: 'scene' | 'divider') =>
      api.post<Scene>(`/scenarios/${scenarioId}/synopsis/scenes`, {
        type,
        sort_order: scenes.length,
        title: '',
      }),
    onSuccess: (scene) => {
      qc.invalidateQueries({ queryKey: ['scenes', scenarioId] })
      if (scene.type === 'scene') onSelect(scene.id)
    },
  })

  const deleteScene = useMutation({
    mutationFn: (id: string) => api.delete(`/scenarios/${scenarioId}/synopsis/scenes/${id}`),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['scenes', scenarioId] })
      if (selectedId === id) onSelect('')
    },
  })

  const togglePlayed = useMutation({
    mutationFn: (scene: Scene) =>
      api.put<Scene>(`/scenarios/${scenarioId}/synopsis/scenes/${scene.id}`, {
        title: scene.title,
        status: scene.status,
        description: scene.description,
        outcome: scene.outcome,
        notes: scene.notes,
        location_id: scene.location_id,
        played: !scene.played,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scenes', scenarioId] }),
  })

  const reorder = useMutation({
    mutationFn: (ids: string[]) =>
      api.post<Scene[]>(`/scenarios/${scenarioId}/synopsis/scenes/reorder`, { ids }),
    onSuccess: (data) => qc.setQueryData(['scenes', scenarioId], data),
  })

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = scenes.findIndex(s => s.id === active.id)
    const newIndex = scenes.findIndex(s => s.id === over.id)
    const reordered = arrayMove(scenes, oldIndex, newIndex)
    qc.setQueryData(['scenes', scenarioId], reordered)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => reorder.mutate(reordered.map(s => s.id)), 400)
  }

  const [showAdd, setShowAdd] = useState(false)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Scènes</h3>
        <div className="flex gap-1">
          <Button
            size="sm" variant="ghost" className="h-7 px-2 text-xs"
            onClick={() => setShowAdd(v => !v)}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {showAdd && (
        <div className="flex gap-1 mb-2">
          <Button
            size="sm" variant="outline" className="h-7 text-xs flex-1"
            onClick={() => { createScene.mutate('scene'); setShowAdd(false) }}
            disabled={createScene.isPending}
          >
            <Plus className="h-3 w-3 mr-1" /> Scène
          </Button>
          <Button
            size="sm" variant="ghost" className="h-7 text-xs flex-1"
            onClick={() => { createScene.mutate('divider'); setShowAdd(false) }}
            disabled={createScene.isPending}
          >
            <SeparatorHorizontal className="h-3 w-3 mr-1" /> Séparateur
          </Button>
        </div>
      )}

      {scenes.length === 0 && (
        <p className="text-xs text-muted-foreground">Aucune scène. Ajoutez-en une ou demandez au LLM.</p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={scenes.map(s => s.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1 flex-1 overflow-y-auto">
            {scenes.map(scene => (
              <SceneRow
                key={scene.id}
                scene={scene}
                selected={selectedId === scene.id}
                onSelect={() => onSelect(scene.id)}
                onDelete={() => deleteScene.mutate(scene.id)}
                onTogglePlayed={() => togglePlayed.mutate(scene)}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="mt-3 pt-3 border-t flex items-center gap-2">
        <Button
          size="sm" variant="outline" className="h-7 px-2 text-xs w-full"
          disabled={llm.suggestScene.isPending}
          onClick={() => llm.suggestScene.mutate()}
        >
          <Sparkles className="h-3.5 w-3.5 mr-1" />
          {llm.suggestScene.isPending ? 'Génération…' : 'Suggérer une scène'}
        </Button>
      </div>
      {llm.suggestScene.isError && (
        <p className="text-xs text-destructive mt-1">{(llm.suggestScene.error as Error).message}</p>
      )}
    </div>
  )
}
