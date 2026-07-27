// Live table surface — projection screen and player seats.
// See docs/play-table.md.

export type ProjectionKind = '' | 'image' | 'text'

export interface Projection {
  kind: ProjectionKind
  url: string
  title: string
  subtitle: string
}

export const EMPTY_PROJECTION: Projection = { kind: '', url: '', title: '', subtitle: '' }

export interface Roll {
  id: string
  session_id: string
  actor: string
  actor_kind: 'gm' | 'player'
  notation: string
  label: string
  detail: string
  total: number
  secret: boolean
  created_at: string
}

export interface Seat {
  name: string
}

/** Everything a table screen or player seat is allowed to know. */
export interface TableSnapshot {
  session_name: string
  scenario_name: string
  campaign_name: string
  projection: Projection
  rolls: Roll[]
  seats: Seat[]
}

export type StreamStatus = 'connecting' | 'live' | 'lost'
