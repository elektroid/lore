import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { AutoTextarea, IncludeToggle, FieldLabel } from './fields'
import type {
  Proposal, ProposalFaction, ProposalLocation, ProposalNPC, ProposalArtefact,
} from '@/types/factory'

// The cast the story needs. Everything here is editable in place and vetoable
// with the tick — the draft is a proposal, so there is nothing to "accept".

interface CastProps {
  proposal: Proposal
  existingNames: Set<string>
  onPatchFaction: (ref: string, patch: Partial<ProposalFaction>) => void
  onPatchLocation: (ref: string, patch: Partial<ProposalLocation>) => void
  onPatchNPC: (ref: string, patch: Partial<ProposalNPC>) => void
  onPatchArtefact: (ref: string, patch: Partial<ProposalArtefact>) => void
}

/** matchKey mirrors the backend's commit-time identity: an item whose name is
 *  already in the campaign binds to that row instead of creating a second one. */
function matchKey(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ')
}

function ReusedBadge() {
  return (
    <span
      title="Déjà dans la campagne — sera réutilisé, pas dupliqué"
      className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground shrink-0"
    >
      réutilisé
    </span>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  if (count === 0) return null
  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-accent/30 transition-colors rounded-lg"
      >
        <span>{title} <span className="text-muted-foreground font-normal">({count})</span></span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <ul className="px-3 pb-3 space-y-2">{children}</ul>}
    </div>
  )
}

function Row({ include, name, reused, onInclude, onName, placeholder, children }: {
  include: boolean
  name: string
  reused: boolean
  onInclude: (v: boolean) => void
  onName: (v: string) => void
  placeholder: string
  children?: React.ReactNode
}) {
  return (
    <li className={`rounded-md border p-2.5 space-y-2 transition-opacity ${include ? '' : 'opacity-45'}`}>
      <div className="flex items-center gap-2">
        <IncludeToggle checked={include} onChange={onInclude} />
        <Input value={name} onChange={e => onName(e.target.value)} placeholder={placeholder} className="h-7 text-sm flex-1" />
        {reused && <ReusedBadge />}
      </div>
      {children}
    </li>
  )
}

export default function CastPanel({
  proposal, existingNames,
  onPatchFaction, onPatchLocation, onPatchNPC, onPatchArtefact,
}: CastProps) {
  const reused = (name: string) => existingNames.has(matchKey(name))

  return (
    <div className="space-y-3">
      <Section title="PNJs" count={proposal.npcs.length}>
        {proposal.npcs.map(n => (
          <Row
            key={n.ref}
            include={n.include}
            name={n.name}
            reused={reused(n.name)}
            onInclude={v => onPatchNPC(n.ref, { include: v })}
            onName={v => onPatchNPC(n.ref, { name: v })}
            placeholder="Nom du PNJ"
          >
            <Input value={n.role} onChange={e => onPatchNPC(n.ref, { role: e.target.value })} placeholder="Rôle dans l'histoire" className="h-7 text-xs" />
            <AutoTextarea value={n.description} onChange={v => onPatchNPC(n.ref, { description: v })} placeholder="Physique, psychologie" className="text-xs" />
            <Input value={n.motivation} onChange={e => onPatchNPC(n.ref, { motivation: e.target.value })} placeholder="Ce qui le fait agir" className="h-7 text-xs" />
            <Input value={n.quote} onChange={e => onPatchNPC(n.ref, { quote: e.target.value })} placeholder="Réplique type" className="h-7 text-xs italic" />
            <div className="flex items-center gap-2">
              <FieldLabel>Faction</FieldLabel>
              <select
                value={n.faction_ref}
                onChange={e => onPatchNPC(n.ref, { faction_ref: e.target.value })}
                className="text-xs rounded border border-input bg-background px-2 py-1 focus:outline-none focus:ring-1 focus:ring-ring flex-1"
              >
                <option value="">— sans faction —</option>
                {proposal.factions.map(f => (
                  <option key={f.ref} value={f.ref}>{f.name}</option>
                ))}
              </select>
            </div>
          </Row>
        ))}
      </Section>

      <Section title="Lieux" count={proposal.locations.length}>
        {proposal.locations.map(l => (
          <Row
            key={l.ref}
            include={l.include}
            name={l.name}
            reused={reused(l.name)}
            onInclude={v => onPatchLocation(l.ref, { include: v })}
            onName={v => onPatchLocation(l.ref, { name: v })}
            placeholder="Nom du lieu"
          >
            <div className="grid grid-cols-2 gap-2">
              <Input value={l.city} onChange={e => onPatchLocation(l.ref, { city: e.target.value })} placeholder="Ville" className="h-7 text-xs" />
              <Input value={l.district} onChange={e => onPatchLocation(l.ref, { district: e.target.value })} placeholder="Quartier" className="h-7 text-xs" />
            </div>
            <Input value={l.atmosphere} onChange={e => onPatchLocation(l.ref, { atmosphere: e.target.value })} placeholder="Ambiance" className="h-7 text-xs" />
            <AutoTextarea value={l.description} onChange={v => onPatchLocation(l.ref, { description: v })} placeholder="Description" className="text-xs" />
          </Row>
        ))}
      </Section>

      <Section title="Factions" count={proposal.factions.length}>
        {proposal.factions.map(f => (
          <Row
            key={f.ref}
            include={f.include}
            name={f.name}
            reused={reused(f.name)}
            onInclude={v => onPatchFaction(f.ref, { include: v })}
            onName={v => onPatchFaction(f.ref, { name: v })}
            placeholder="Nom de la faction"
          >
            <Input value={f.type} onChange={e => onPatchFaction(f.ref, { type: e.target.value })} placeholder="Type (corpo, gang, agence…)" className="h-7 text-xs" />
            <AutoTextarea value={f.description} onChange={v => onPatchFaction(f.ref, { description: v })} placeholder="Description" className="text-xs" />
            <Input value={f.motivation} onChange={e => onPatchFaction(f.ref, { motivation: e.target.value })} placeholder="Ce qu'elle veut" className="h-7 text-xs" />
          </Row>
        ))}
      </Section>

      <Section title="Artefacts" count={proposal.artefacts.length}>
        {proposal.artefacts.map(a => (
          <Row
            key={a.ref}
            include={a.include}
            name={a.name}
            reused={reused(a.name)}
            onInclude={v => onPatchArtefact(a.ref, { include: v })}
            onName={v => onPatchArtefact(a.ref, { name: v })}
            placeholder="Nom de l'artefact"
          >
            <AutoTextarea value={a.description} onChange={v => onPatchArtefact(a.ref, { description: v })} placeholder="Description" className="text-xs" />
          </Row>
        ))}
      </Section>
    </div>
  )
}
