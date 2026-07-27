// Dice notation helpers for the UI. The authoritative parser and roller live
// server-side (backend/internal/dice) — everything here is about composing a
// notation string with buttons and giving early feedback before the round trip.

export const QUICK_DICE = [4, 6, 8, 10, 12, 20, 100] as const

/** Mirrors the grammar of backend/internal/dice. */
const TERM = /^(?:(\d*)d(\d+|%)(?:(?:kh|kl)\d*)?|\d+)$/

export function isValidNotation(input: string): boolean {
  const clean = input.replace(/\s+/g, '').toLowerCase()
  if (!clean || clean.length > 64) return false

  const terms = clean.replace(/^[+-]/, '').split(/[+-]/)
  if (terms.length > 20) return false
  return terms.every(t => TERM.test(t))
}

/**
 * Adds one die to a notation, the way a physical handful grows: clicking d6
 * three times gives `3d6`, not `1d6+1d6+1d6`. A different die starts a new term.
 */
export function addDie(notation: string, sides: number): string {
  const clean = notation.trim()
  if (!clean) return `1d${sides}`

  const tail = clean.match(/(\d*)d(\d+)$/)
  if (tail && Number(tail[2]) === sides) {
    const count = tail[1] === '' ? 1 : Number(tail[1])
    return clean.slice(0, tail.index) + `${count + 1}d${sides}`
  }
  return `${clean}+1d${sides}`
}

/** Nudges the trailing constant, adding or removing one as needed. */
export function addModifier(notation: string, delta: number): string {
  const clean = notation.trim()
  if (!clean) return delta > 0 ? `${delta}` : `${delta}`

  const tail = clean.match(/([+-])(\d+)$/)
  if (!tail) {
    const next = delta
    return next === 0 ? clean : `${clean}${next > 0 ? '+' : '-'}${Math.abs(next)}`
  }

  const current = (tail[1] === '-' ? -1 : 1) * Number(tail[2])
  const next = current + delta
  const head = clean.slice(0, tail.index)
  if (next === 0) return head
  return `${head}${next > 0 ? '+' : '-'}${Math.abs(next)}`
}

/** "il y a 2 min" — the roll feed only ever needs coarse recency. */
export function relativeTime(iso: string): string {
  const then = Date.parse(iso.includes('Z') || iso.includes('+') ? iso : iso.replace(' ', 'T') + 'Z')
  if (Number.isNaN(then)) return ''

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 10) return "à l'instant"
  if (seconds < 60) return `il y a ${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.round(minutes / 60)
  return `il y a ${hours} h`
}
