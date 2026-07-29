import { useState } from 'react'
import { Sparkles, Trash2, FileText, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AutoTextarea, FieldLabel } from './fields'
import { SCENE_COUNT_OPTIONS, type ScenarioDraft } from '@/types/factory'

interface Props {
  drafts: ScenarioDraft[]
  isGenerating: boolean
  error: string
  onGenerate: (brief: string, sceneCount: number) => void
  onOpen: (draftId: string) => void
  onDelete: (draftId: string) => void
}

const PLACEHOLDER = `Un fixer du Kabuki disparaît après avoir vendu aux PJs un contrat trop beau. Trois jours plus tard son cadavre refait surface avec, dans le crâne, une puce qui porte leur nom.

Je veux une enquête qui tourne à la chasse à l'homme, et une trahison au dernier acte.`

export default function BriefForm({ drafts, isGenerating, error, onGenerate, onOpen, onDelete }: Props) {
  const [brief, setBrief] = useState('')
  const [sceneCount, setSceneCount] = useState(6)

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Fabrique de scénario</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Donnez une idée de départ — une situation, une accroche, une fin que vous avez en tête.
          Le moteur en tire un scénario complet : pitch, PNJs, lieux, factions et le déroulé des scènes.
          Rien n'entre dans la campagne avant que vous ne le validiez.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-5 space-y-4">
        <div className="space-y-1.5">
          <FieldLabel>Idée de départ</FieldLabel>
          <AutoTextarea
            value={brief}
            onChange={setBrief}
            placeholder={PLACEHOLDER}
            rows={8}
            disabled={isGenerating}
            className="min-h-[180px]"
          />
          <p className="text-xs text-muted-foreground">
            Le système de jeu, le genre et les entités déjà créées sont ajoutés automatiquement au contexte.
          </p>
        </div>

        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div className="space-y-1.5">
            <FieldLabel>Nombre de scènes</FieldLabel>
            <select
              value={sceneCount}
              onChange={e => setSceneCount(Number(e.target.value))}
              disabled={isGenerating}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
            >
              {SCENE_COUNT_OPTIONS.map(n => (
                <option key={n} value={n}>{n} scènes</option>
              ))}
            </select>
          </div>

          <Button
            onClick={() => onGenerate(brief.trim(), sceneCount)}
            disabled={!brief.trim() || isGenerating}
          >
            <Sparkles className={`h-4 w-4 ${isGenerating ? 'animate-pulse' : ''}`} />
            {isGenerating ? 'Écriture en cours…' : 'Générer le scénario'}
          </Button>
        </div>

        {isGenerating && (
          <p className="text-xs text-muted-foreground">
            Le moteur écrit le casting et le déroulé d'un seul tenant, pour que l'histoire se tienne. Comptez une trentaine de secondes.
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>

      {drafts.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium">Brouillons</p>
          <ul className="space-y-1.5">
            {drafts.map(d => (
              <li
                key={d.id}
                className="flex items-center gap-3 p-3 rounded-md border bg-card hover:bg-accent/50 transition-colors"
              >
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <button
                  className="flex-1 text-sm font-medium text-left truncate hover:underline"
                  onClick={() => onOpen(d.id)}
                >
                  {d.title || <span className="text-muted-foreground italic">(sans titre)</span>}
                </button>
                {d.status === 'committed' ? (
                  <span className="text-xs text-muted-foreground shrink-0">Transformé en scénario</span>
                ) : (
                  <span className="text-xs text-muted-foreground shrink-0">
                    {new Date(d.created_at).toLocaleDateString('fr-FR')}
                  </span>
                )}
                <Button
                  size="sm" variant="ghost" className="h-6 w-6 p-0 shrink-0"
                  onClick={() => onOpen(d.id)}
                  title="Ouvrir"
                >
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm" variant="ghost"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => onDelete(d.id)}
                  title="Supprimer le brouillon"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
