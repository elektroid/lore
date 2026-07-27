import { useEffect, useRef, useState } from 'react'
import type { Projection, Roll, StreamStatus, TableSnapshot } from '@/types/table'

const FEED_LIMIT = 50

interface Options {
  /** Fires for every roll that arrives on the wire — not for the initial snapshot. */
  onRoll?: (roll: Roll) => void
}

interface Stream {
  snapshot: TableSnapshot | null
  status: StreamStatus
  /** Set when the token is unknown or revoked — the stream is not retried. */
  error: string | null
}

/**
 * Subscribes to a session's live table stream.
 *
 * The snapshot is fetched once up front so an invalid token fails loudly instead
 * of leaving an EventSource retrying against a 404 forever. After that the
 * stream owns the state: `state` replaces it wholesale (which is also how a
 * reconnect resyncs), `projection` and `roll` patch it.
 */
export function useTableStream(token: string, options: Options = {}): Stream {
  const [snapshot, setSnapshot] = useState<TableSnapshot | null>(null)
  const [status, setStatus] = useState<StreamStatus>('connecting')
  const [error, setError] = useState<string | null>(null)

  // Kept in a ref so changing the callback never tears the connection down.
  const onRollRef = useRef(options.onRoll)
  useEffect(() => { onRollRef.current = options.onRoll })

  useEffect(() => {
    if (!token) return

    let cancelled = false
    let source: EventSource | null = null

    async function connect() {
      setStatus('connecting')
      setError(null)

      let initial: TableSnapshot
      try {
        const res = await fetch(`/api/table/${token}`)
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          throw new Error(body?.error ?? 'Lien de table invalide')
        }
        initial = (await res.json()) as TableSnapshot
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message)
          setStatus('lost')
        }
        return
      }
      if (cancelled) return
      setSnapshot(initial)

      source = new EventSource(`/api/table/${token}/stream`)
      source.addEventListener('open', () => setStatus('live'))
      source.addEventListener('error', () => setStatus('lost')) // EventSource retries on its own

      source.addEventListener('state', e => {
        setSnapshot(JSON.parse((e as MessageEvent).data) as TableSnapshot)
        setStatus('live')
      })

      source.addEventListener('projection', e => {
        const projection = JSON.parse((e as MessageEvent).data) as Projection
        setSnapshot(s => (s ? { ...s, projection } : s))
      })

      source.addEventListener('roll', e => {
        const roll = JSON.parse((e as MessageEvent).data) as Roll
        setSnapshot(s => {
          if (!s) return s
          if (s.rolls.some(r => r.id === roll.id)) return s
          return { ...s, rolls: [roll, ...s.rolls].slice(0, FEED_LIMIT) }
        })
        onRollRef.current?.(roll)
      })
    }

    connect()

    return () => {
      cancelled = true
      source?.close()
    }
  }, [token])

  return { snapshot, status, error }
}
