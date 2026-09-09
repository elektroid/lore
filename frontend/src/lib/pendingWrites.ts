/**
 * The last line of defence for debounced autosaves.
 *
 * Every auto-saving field in the app waits out a debounce (800 ms for entity
 * fields, 1 500 ms for the synopsis) before it writes. Unmounting flushes that
 * draft — but unmounting only happens on a *client-side* route change. When the
 * document itself goes away — a plain `<a href>` to an in-app route, a reload,
 * the tab closing, the back button after a hard navigation — React never gets
 * to run a cleanup, the pending timer dies with the page, and everything typed
 * since the last write is gone with no error and no trace.
 *
 * That is not hypothetical: the Synopsis toolbar shipped a raw `<a href>` to
 * the entities page, so "type a paragraph, click Entités" reliably lost the
 * paragraph. The links are fixed, but any future one would reintroduce it, and
 * reload and tab-close never had a fix at all. So instead of trusting every
 * call site, every debounced saver registers its flush here, and this module
 * fires them all on the way out.
 *
 * `pagehide` is the event that actually fires in every unload path (including
 * bfcache and mobile Safari, where `beforeunload` does not); `visibilitychange`
 * to hidden covers the OS killing a backgrounded tab. Both can fire more than
 * once, which is fine — a flush with nothing pending is a no-op.
 */

type Flush = () => void

const flushers = new Set<Flush>()

/** True while the document is tearing down — see `keepalive` in api/client.ts. */
let unloading = false

export function isUnloading(): boolean {
  return unloading
}

/**
 * Register a flush callback for the lifetime of a component. Returns the
 * unregister function, so the usual shape is:
 *
 * ```ts
 * useEffect(() => registerPendingWrite(flush), [flush])
 * ```
 */
export function registerPendingWrite(flush: Flush): () => void {
  flushers.add(flush)
  return () => { flushers.delete(flush) }
}

/** Whether anything is currently waiting on a debounce. */
const dirtyMarkers = new Set<() => boolean>()

export function registerDirtyCheck(isDirty: () => boolean): () => void {
  dirtyMarkers.add(isDirty)
  return () => { dirtyMarkers.delete(isDirty) }
}

export function hasPendingWrites(): boolean {
  for (const d of dirtyMarkers) if (d()) return true
  return false
}

function flushAll() {
  unloading = true
  for (const f of flushers) {
    try { f() } catch { /* one broken saver must not stop the others */ }
  }
  // The flag only exists to make the requests those flushes just issued use
  // `keepalive`. If the page turns out not to be going away after all (a
  // backgrounded tab that comes back), clear it so normal writes resume.
  queueMicrotask(() => { unloading = false })
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushAll)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushAll()
  })
}
