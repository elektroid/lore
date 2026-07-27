import type { QueryClient, QueryKey } from '@tanstack/react-query'

/**
 * Patch one item of a cached list in place.
 *
 * Editors save on a debounce, so without this the lists that show the same
 * record (scene list, entity tabs, breadcrumbs) only catch up a second after
 * the user stopped typing. Patching the cache on every keystroke makes them
 * follow the input; the server response then reconciles.
 */
export function patchCachedListItem<T extends { id: string }>(
  qc: QueryClient,
  key: QueryKey,
  id: string,
  patch: Partial<T>,
) {
  qc.setQueryData<T[]>(key, old =>
    old?.map(item => (item.id === id ? { ...item, ...patch } : item)),
  )
}

/** Patch a cached single record, if it has been loaded. */
export function patchCachedItem<T>(qc: QueryClient, key: QueryKey, patch: Partial<T>) {
  qc.setQueryData<T>(key, old => (old ? { ...old, ...patch } : old))
}
