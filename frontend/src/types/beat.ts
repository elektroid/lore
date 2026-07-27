// Improvised beats — what the players did that the scenario never anticipated.
// See docs/play-improv.md.

export type BeatStatus = 'captured' | 'developed' | 'adopted' | 'dropped'

export type Verdict = 'ok' | 'tension' | 'conflict'

export interface Impact {
  scene_ref: string
  scene_id: string
  title: string
  note: string
}

export interface Coherency {
  verdict: Verdict
  summary: string
  impacts: Impact[]
}

export interface SessionBeat {
  id: string
  session_id: string
  session_name: string
  scenario_id: string
  anchor_scene_id: string
  anchor_title: string
  /** The GM's own words, typed at the table. Never overwritten by the LLM. */
  note: string
  status: BeatStatus
  title: string
  description: string
  outcome: string
  notes: string
  coherency: string // JSON Coherency
  scene_id: string  // set on adopt
  created_at: string
  updated_at: string
}

const emptyCoherency: Coherency = { verdict: 'ok', summary: '', impacts: [] }

export function parseCoherency(raw: string): Coherency {
  try {
    const c = JSON.parse(raw) as Partial<Coherency>
    return {
      verdict: c.verdict ?? 'ok',
      summary: c.summary ?? '',
      impacts: c.impacts ?? [],
    }
  } catch {
    return emptyCoherency
  }
}

export const VERDICT_LABELS: Record<Verdict, string> = {
  ok: 'Cohérent',
  tension: 'Tension',
  conflict: 'Contradiction',
}

/** Colour only carries urgency — the verdict never blocks adoption. */
export const VERDICT_CLASSES: Record<Verdict, string> = {
  ok: 'bg-emerald-50 border-emerald-300 text-emerald-700 dark:bg-emerald-950 dark:border-emerald-800 dark:text-emerald-400',
  tension: 'bg-amber-50 border-amber-300 text-amber-700 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-400',
  conflict: 'bg-rose-50 border-rose-300 text-rose-700 dark:bg-rose-950 dark:border-rose-800 dark:text-rose-400',
}
