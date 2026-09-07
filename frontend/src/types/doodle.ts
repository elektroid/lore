// Doodle: a GM-shared scheduling poll. Deliberately outside the
// campaign/run/session model — see CLAUDE.md's "story vs. play" split. A
// doodle names no campaign, no run, no player list: just a title and a
// handful of proposed date/time slots, voted on by name through a plain
// share link.

export type DoodleAnswer = 'yes' | 'no' | 'maybe'

export interface Doodle {
  id: string
  owner_id: string
  title: string
  description: string
  share_token: string
  closed: boolean
  created_at: string
  updated_at: string
}

export interface DoodleSlot {
  id: string
  doodle_id: string
  starts_at: string
}

export interface DoodleRespondentVotes {
  id: string
  name: string
  votes: Record<string, DoodleAnswer>
}

export interface DoodleDetail {
  doodle: Doodle
  slots: DoodleSlot[]
  respondents: DoodleRespondentVotes[]
}

/** What the public voting page is allowed to know — no owner ID, no token. */
export interface PublicDoodleDetail {
  title: string
  description: string
  closed: boolean
  slots: DoodleSlot[]
  respondents: DoodleRespondentVotes[]
}

export function shareUrl(doodle: Doodle): string {
  return `${window.location.origin}/doodles/share/${doodle.share_token}`
}
