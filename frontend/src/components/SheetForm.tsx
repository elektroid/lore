import { useMemo } from 'react'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import type { FieldScope, SheetField, SheetSchema, SheetValues } from '@/types/sheetTemplate'
import { evaluateSheet } from '@/lib/sheetFormula'

const selectClass = 'w-full text-sm rounded-md border border-input bg-background px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ring'

function setValue(values: SheetValues, key: string, value: unknown): SheetValues {
  // Spreads over the previous values so keys outside the current schema
  // (e.g. left over from a template edit) survive the round-trip.
  return { ...values, [key]: value }
}

function NumberField({ field, values, onChange }: { field: SheetField; values: SheetValues; onChange: (v: SheetValues) => void }) {
  const raw = values[field.key]
  const value = typeof raw === 'number' ? raw : (raw === undefined || raw === '' ? '' : Number(raw))
  return (
    <div className="space-y-1">
      <Label className="text-xs">{field.label}</Label>
      <Input
        type="number"
        min={field.min}
        max={field.max}
        value={value}
        placeholder={field.default !== undefined ? String(field.default) : undefined}
        onChange={e => onChange(setValue(values, field.key, e.target.value === '' ? '' : Number(e.target.value)))}
        className="h-8"
      />
    </div>
  )
}

function SelectField({ field, values, onChange }: { field: SheetField; values: SheetValues; onChange: (v: SheetValues) => void }) {
  const value = typeof values[field.key] === 'string' ? values[field.key] as string : ''
  return (
    <div className="space-y-1">
      <Label className="text-xs">{field.label}</Label>
      <select value={value} onChange={e => onChange(setValue(values, field.key, e.target.value))} className={selectClass}>
        <option value="">—</option>
        {(field.options ?? []).map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  )
}

function TextField({ field, values, onChange }: { field: SheetField; values: SheetValues; onChange: (v: SheetValues) => void }) {
  const value = typeof values[field.key] === 'string' ? values[field.key] as string : ''
  return (
    <div className="space-y-1">
      <Label className="text-xs">{field.label}</Label>
      <Input value={value} onChange={e => onChange(setValue(values, field.key, e.target.value))} className="h-8" />
    </div>
  )
}

function FormulaField({ field, formulas }: { field: SheetField; formulas: ReturnType<typeof evaluateSheet> }) {
  const result = formulas[field.key]
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{field.label}</Label>
      {result && 'error' in result ? (
        <p className="h-8 flex items-center text-xs text-destructive" title={result.error}>erreur</p>
      ) : (
        <p className="h-8 flex items-center text-sm font-medium">{result?.value ?? '—'}</p>
      )}
    </div>
  )
}

function SkillListField({ field, values, onChange }: { field: SheetField; values: SheetValues; onChange: (v: SheetValues) => void }) {
  const levels = (values[field.key] && typeof values[field.key] === 'object' ? values[field.key] as Record<string, number> : {})

  const groups = new Map<string, typeof field.items>()
  for (const item of field.items ?? []) {
    const g = item.group ?? ''
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(item)
  }

  function setLevel(skillKey: string, level: number) {
    const nextLevels = { ...levels, [skillKey]: level }
    onChange(setValue(values, field.key, nextLevels))
  }

  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([group, items]) => (
        <div key={group}>
          {group && <p className="text-xs font-medium text-muted-foreground mb-1">{group}</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
            {items?.map(item => (
              <div key={item.key} className="flex items-center justify-between gap-2">
                <span className="text-xs truncate" title={item.stat ? item.stat.toUpperCase() : undefined}>
                  {item.label}{item.stat ? <span className="text-muted-foreground"> ({item.stat.toUpperCase()})</span> : null}
                </span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={levels[item.key] ?? 0}
                  onChange={e => setLevel(item.key, Number(e.target.value))}
                  className="h-6 w-12 text-xs text-center rounded border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

interface Props {
  schema: SheetSchema
  values: SheetValues
  scope: FieldScope
  onChange: (values: SheetValues) => void
}

/** The one renderer used everywhere a sheet is shown or edited. */
export default function SheetForm({ schema, values, scope, onChange }: Props) {
  const formulas = useMemo(() => evaluateSheet(schema, values), [schema, values])

  const visibleSections = schema.sections
    .map(section => ({ ...section, fields: section.fields.filter(f => f.scope.includes(scope)) }))
    .filter(section => section.fields.length > 0)

  if (visibleSections.length === 0) {
    return <p className="text-xs text-muted-foreground">Aucun champ pour cette fiche.</p>
  }

  return (
    <div className="space-y-5">
      {visibleSections.map(section => (
        <div key={section.title}>
          <p className="text-sm font-medium mb-2">{section.title}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {section.fields.map(field => {
              if (field.type === 'skill_list') {
                return <div key={field.key} className="col-span-full"><SkillListField field={field} values={values} onChange={onChange} /></div>
              }
              if (field.type === 'formula') {
                return <FormulaField key={field.key} field={field} formulas={formulas} />
              }
              if (field.type === 'select') {
                return <SelectField key={field.key} field={field} values={values} onChange={onChange} />
              }
              if (field.type === 'text') {
                return <TextField key={field.key} field={field} values={values} onChange={onChange} />
              }
              return <NumberField key={field.key} field={field} values={values} onChange={onChange} />
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
