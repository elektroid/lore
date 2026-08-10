import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, ChevronUp, ChevronDown, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AppShell from '@/components/AppShell'
import SheetForm from '@/components/SheetForm'
import { api } from '@/api/client'
import { useUser } from '@/stores/auth'
import { useDocTitle } from '@/hooks/useDocTitle'
import type { FieldScope, FieldType, SheetField, SheetSchema, SheetSection, SheetTemplate, SheetValues } from '@/types/sheetTemplate'
import { parseSheetSchema } from '@/types/sheetTemplate'
import { parseFormula } from '@/lib/sheetFormula'

const selectClass = 'text-xs rounded border border-input bg-background px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-ring'

const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  number: 'Nombre',
  select: 'Choix',
  text: 'Texte',
  formula: 'Calculé',
  skill_list: 'Liste de compétences',
}

function emptyField(type: FieldType): SheetField {
  const base = { key: '', label: '', type, scope: ['pc', 'npc'] as FieldScope[] }
  if (type === 'number') return { ...base, min: 1, max: 10, default: 5 }
  if (type === 'select') return { ...base, options: [] }
  if (type === 'formula') return { ...base, expression: '' }
  if (type === 'skill_list') return { ...base, items: [] }
  return base
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list
  const copy = [...list]
  const [item] = copy.splice(from, 1)
  copy.splice(to, 0, item)
  return copy
}

function FieldEditor({ field, onChange, onRemove, onMove }: {
  field: SheetField
  onChange: (f: SheetField) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const formulaCheck = field.type === 'formula' ? parseFormula(field.expression ?? '') : null

  return (
    <div className="border rounded-md p-2.5 space-y-2 bg-card">
      <div className="flex items-center gap-1.5">
        <Input value={field.key} onChange={e => onChange({ ...field, key: e.target.value })} placeholder="clé (ex: body)" className="h-7 text-xs font-mono w-32" />
        <Input value={field.label} onChange={e => onChange({ ...field, label: e.target.value })} placeholder="Libellé" className="h-7 text-xs flex-1" />
        <select value={field.type} onChange={e => onChange(emptyField(e.target.value as FieldType))} className={selectClass}>
          {Object.entries(FIELD_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <label className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          <input type="checkbox" checked={field.scope.includes('pc')}
            onChange={e => onChange({ ...field, scope: e.target.checked ? [...field.scope, 'pc'] : field.scope.filter(s => s !== 'pc') })} />
          PJ
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
          <input type="checkbox" checked={field.scope.includes('npc')}
            onChange={e => onChange({ ...field, scope: e.target.checked ? [...field.scope, 'npc'] : field.scope.filter(s => s !== 'npc') })} />
          PNJ
        </label>
        <button onClick={() => onMove(-1)} className="p-0.5 text-muted-foreground/60 hover:text-muted-foreground"><ChevronUp className="h-3.5 w-3.5" /></button>
        <button onClick={() => onMove(1)} className="p-0.5 text-muted-foreground/60 hover:text-muted-foreground"><ChevronDown className="h-3.5 w-3.5" /></button>
        <button onClick={onRemove} className="p-0.5 text-muted-foreground/60 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>

      {field.type === 'number' && (
        <div className="flex items-center gap-2 pl-1">
          <label className="text-xs text-muted-foreground">min <input type="number" value={field.min ?? ''} onChange={e => onChange({ ...field, min: Number(e.target.value) })} className="h-6 w-14 text-xs ml-1 rounded border border-input bg-background px-1" /></label>
          <label className="text-xs text-muted-foreground">max <input type="number" value={field.max ?? ''} onChange={e => onChange({ ...field, max: Number(e.target.value) })} className="h-6 w-14 text-xs ml-1 rounded border border-input bg-background px-1" /></label>
          <label className="text-xs text-muted-foreground">défaut <input type="number" value={field.default ?? ''} onChange={e => onChange({ ...field, default: Number(e.target.value) })} className="h-6 w-14 text-xs ml-1 rounded border border-input bg-background px-1" /></label>
        </div>
      )}

      {field.type === 'select' && (
        <div className="pl-1 space-y-1">
          {(field.options ?? []).map((o, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input value={o.value} onChange={e => {
                const options = [...(field.options ?? [])]; options[i] = { ...o, value: e.target.value }; onChange({ ...field, options })
              }} placeholder="valeur" className="h-6 text-xs font-mono w-28" />
              <Input value={o.label} onChange={e => {
                const options = [...(field.options ?? [])]; options[i] = { ...o, label: e.target.value }; onChange({ ...field, options })
              }} placeholder="libellé affiché" className="h-6 text-xs flex-1" />
              <button onClick={() => onChange({ ...field, options: (field.options ?? []).filter((_, j) => j !== i) })} className="p-0.5 text-muted-foreground/60 hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button
            onClick={() => onChange({ ...field, options: [...(field.options ?? []), { value: '', label: '' }] })}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Plus className="h-3 w-3" />ajouter une option
          </button>
        </div>
      )}

      {field.type === 'formula' && (
        <div className="pl-1 space-y-1">
          <Input
            value={field.expression ?? ''}
            onChange={e => onChange({ ...field, expression: e.target.value })}
            placeholder="ex: ceil(avg(body,will))*5+10"
            className="h-7 text-xs font-mono"
          />
          {formulaCheck && !formulaCheck.ok && (
            <p className="text-xs text-destructive">{formulaCheck.error}</p>
          )}
        </div>
      )}

      {field.type === 'skill_list' && (
        <div className="pl-1 space-y-1">
          {(field.items ?? []).map((item, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input value={item.key} onChange={e => {
                const items = [...(field.items ?? [])]; items[i] = { ...item, key: e.target.value }; onChange({ ...field, items })
              }} placeholder="clé" className="h-6 text-xs font-mono w-24" />
              <Input value={item.label} onChange={e => {
                const items = [...(field.items ?? [])]; items[i] = { ...item, label: e.target.value }; onChange({ ...field, items })
              }} placeholder="Libellé" className="h-6 text-xs flex-1" />
              <Input value={item.stat ?? ''} onChange={e => {
                const items = [...(field.items ?? [])]; items[i] = { ...item, stat: e.target.value }; onChange({ ...field, items })
              }} placeholder="stat liée" className="h-6 text-xs font-mono w-20" />
              <Input value={item.group ?? ''} onChange={e => {
                const items = [...(field.items ?? [])]; items[i] = { ...item, group: e.target.value }; onChange({ ...field, items })
              }} placeholder="catégorie" className="h-6 text-xs w-24" />
              <button onClick={() => onChange({ ...field, items: (field.items ?? []).filter((_, j) => j !== i) })} className="p-0.5 text-muted-foreground/60 hover:text-destructive">
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button
            onClick={() => onChange({ ...field, items: [...(field.items ?? []), { key: '', label: '', stat: '', group: '' }] })}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <Plus className="h-3 w-3" />ajouter une compétence
          </button>
        </div>
      )}
    </div>
  )
}

function SectionEditor({ section, onChange, onRemove, onMove }: {
  section: SheetSection
  onChange: (s: SheetSection) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  function updateField(i: number, f: SheetField) {
    const fields = [...section.fields]; fields[i] = f; onChange({ ...section, fields })
  }
  function removeField(i: number) {
    onChange({ ...section, fields: section.fields.filter((_, j) => j !== i) })
  }

  return (
    <div className="border rounded-lg p-3 space-y-2.5">
      <div className="flex items-center gap-2">
        <Input value={section.title} onChange={e => onChange({ ...section, title: e.target.value })} placeholder="Titre de section" className="h-8 text-sm font-medium flex-1" />
        <button onClick={() => onMove(-1)} className="p-1 text-muted-foreground/60 hover:text-muted-foreground"><ChevronUp className="h-3.5 w-3.5" /></button>
        <button onClick={() => onMove(1)} className="p-1 text-muted-foreground/60 hover:text-muted-foreground"><ChevronDown className="h-3.5 w-3.5" /></button>
        <button onClick={onRemove} className="p-1 text-muted-foreground/60 hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
      <div className="space-y-2">
        {section.fields.map((f, i) => (
          <FieldEditor
            key={i}
            field={f}
            onChange={nf => updateField(i, nf)}
            onRemove={() => removeField(i)}
            onMove={dir => onChange({ ...section, fields: move(section.fields, i, i + dir) })}
          />
        ))}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).map(t => (
          <button
            key={t}
            onClick={() => onChange({ ...section, fields: [...section.fields, emptyField(t)] })}
            className="text-xs px-2 py-1 rounded border border-dashed text-muted-foreground hover:text-foreground hover:border-foreground/40"
          >
            <Plus className="h-3 w-3 inline mr-0.5" />{FIELD_TYPE_LABELS[t]}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function SheetTemplateEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const isAdmin = useUser()?.role === 'superuser'
  const qc = useQueryClient()

  const { data: tmpl, isLoading } = useQuery({
    queryKey: ['sheet-template', id],
    queryFn: () => api.get<SheetTemplate>(`/sheet-templates/${id}`),
    enabled: !!id,
  })

  useDocTitle(tmpl ? `lore: fiche ${tmpl.name}` : 'lore: fiche')

  const [name, setName] = useState('')
  const [schema, setSchema] = useState<SheetSchema>({ sections: [] })
  const [previewValues, setPreviewValues] = useState<SheetValues>({})
  const [previewScope, setPreviewScope] = useState<FieldScope>('pc')
  const [importText, setImportText] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [importError, setImportError] = useState('')
  const loaded = useRef(false)

  useEffect(() => {
    if (tmpl && !loaded.current) {
      setName(tmpl.name)
      setSchema(parseSheetSchema(tmpl.schema))
      loaded.current = true
    }
  }, [tmpl])

  const save = useMutation({
    mutationFn: () => api.put<SheetTemplate>(`/sheet-templates/${id}`, { name, schema: JSON.stringify(schema) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sheet-template', id] })
      qc.invalidateQueries({ queryKey: ['sheet-templates'] })
    },
  })

  function updateSection(i: number, s: SheetSection) {
    const sections = [...schema.sections]; sections[i] = s; setSchema({ sections })
  }
  function removeSection(i: number) {
    setSchema({ sections: schema.sections.filter((_, j) => j !== i) })
  }

  function importJson() {
    try {
      const parsed = JSON.parse(importText)
      if (!parsed || !Array.isArray(parsed.sections)) throw new Error('doit contenir un tableau "sections"')
      setSchema(parsed as SheetSchema)
      setImportError('')
      setImportOpen(false)
      setImportText('')
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!isAdmin) {
    return (
      <AppShell crumbs={[{ label: 'Fiches de personnage', to: '/sheet-templates' }, { label: '…' }]}>
        <main className="max-w-2xl mx-auto px-6 py-10">
          <p className="text-sm text-muted-foreground">Réservé aux administrateurs.</p>
        </main>
      </AppShell>
    )
  }

  if (isLoading || !tmpl) {
    return (
      <AppShell crumbs={[{ label: 'Fiches de personnage', to: '/sheet-templates' }, { label: '…' }]}>
        <main className="max-w-2xl mx-auto px-6 py-10">
          <p className="text-sm text-muted-foreground">Chargement…</p>
        </main>
      </AppShell>
    )
  }

  return (
    <AppShell crumbs={[{ label: 'Fiches de personnage', to: '/sheet-templates' }, { label: name || tmpl.name }]}>
      <main className="max-w-5xl mx-auto px-6 py-10 grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="space-y-4 min-w-0">
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/sheet-templates')} className="text-muted-foreground hover:text-foreground">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <Input value={name} onChange={e => setName(e.target.value)} className="h-9 text-lg font-bold flex-1" />
            <Button size="sm" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
          {save.isError && <p className="text-xs text-destructive">{(save.error as Error).message}</p>}
          {save.isSuccess && <p className="text-xs text-muted-foreground">Enregistré.</p>}

          <div className="space-y-3">
            {schema.sections.map((s, i) => (
              <SectionEditor
                key={i}
                section={s}
                onChange={ns => updateSection(i, ns)}
                onRemove={() => removeSection(i)}
                onMove={dir => setSchema({ sections: move(schema.sections, i, i + dir) })}
              />
            ))}
          </div>

          <Button size="sm" variant="outline" onClick={() => setSchema({ sections: [...schema.sections, { title: 'Nouvelle section', fields: [] }] })}>
            <Plus className="h-3.5 w-3.5 mr-1" />Ajouter une section
          </Button>

          <div className="pt-4 border-t">
            <button onClick={() => setImportOpen(o => !o)} className="text-xs text-muted-foreground hover:text-foreground">
              Avancé : importer un schéma JSON
            </button>
            {importOpen && (
              <div className="mt-2 space-y-2">
                <textarea
                  value={importText}
                  onChange={e => setImportText(e.target.value)}
                  placeholder='{"sections": [...]}'
                  rows={6}
                  className="w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-xs font-mono shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={importJson}>Remplacer le schéma</Button>
                  {importError && <p className="text-xs text-destructive">{importError}</p>}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0">
          <div className="sticky top-6 space-y-3">
            <div className="flex items-center justify-between">
              <Label>Aperçu</Label>
              <div className="flex items-center gap-1 text-xs">
                <button
                  onClick={() => setPreviewScope('pc')}
                  className={`px-2 py-1 rounded ${previewScope === 'pc' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >PJ</button>
                <button
                  onClick={() => setPreviewScope('npc')}
                  className={`px-2 py-1 rounded ${previewScope === 'npc' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >PNJ</button>
              </div>
            </div>
            <div className="border rounded-lg p-4 bg-card">
              <SheetForm schema={schema} values={previewValues} scope={previewScope} onChange={setPreviewValues} />
            </div>
          </div>
        </div>
      </main>
    </AppShell>
  )
}
