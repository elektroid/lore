import { useCallback, useEffect, useMemo, useRef } from 'react'

/**
 * Debounced field saving for the "type into a form, PUT the whole record"
 * pattern used by the entity editors.
 *
 * The pending draft is never dropped: it is flushed when the component
 * unmounts, when the edited record changes, and before any immediate write.
 * The save callback is captured at schedule time, so a draft flushed after the
 * editor switched records still writes to the record it was typed into.
 */
export function useDebouncedSave<P extends object>(delay = 800) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<{ patch: P; save: (patch: P) => void } | null>(null)

  const cancelTimer = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  /** Send the pending draft now, if any. */
  const flush = useCallback(() => {
    cancelTimer()
    const p = pending.current
    pending.current = null
    if (p && Object.keys(p.patch).length > 0) p.save(p.patch)
  }, [cancelTimer])

  /** Queue a field change; merges with whatever is already pending. */
  const schedule = useCallback((patch: P, save: (patch: P) => void) => {
    pending.current = { patch: { ...pending.current?.patch, ...patch } as P, save }
    cancelTimer()
    timer.current = setTimeout(flush, delay)
  }, [cancelTimer, delay, flush])

  /**
   * Write immediately, merging the pending draft in first — otherwise a
   * full-record PUT would overwrite fields the user just typed.
   */
  const saveNow = useCallback((patch: P, save: (patch: P) => void) => {
    const merged = { ...pending.current?.patch, ...patch } as P
    cancelTimer()
    pending.current = null
    save(merged)
  }, [cancelTimer])

  useEffect(() => () => flush(), [flush])

  // Stable identity — callers list it in effect dependencies.
  return useMemo(() => ({ schedule, saveNow, flush }), [schedule, saveNow, flush])
}
