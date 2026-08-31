import { useEffect } from 'react'
import { useModeStore, type AppMode } from '@/stores/mode'

// Keeps the top-bar mode badge honest on pages that unambiguously belong to
// one mode. Reaching such a page other than through the mode picker/switcher
// — a deep link, a pasted URL, browser back — must not leave the badge
// showing a mode that disagrees with what's actually on screen. Mode is a
// navigation lens, not an access boundary (ownership/role already gate what
// each page allows), so this only ever updates the badge, never redirects.
// `enabled` matters on pages that redirect a subset of visitors elsewhere
// (e.g. AdminPage sends a non-superuser back to "/", which itself redirects
// to "/admin" whenever mode is 'admin' — syncing unconditionally there would
// set mode='admin' right before the redirect and the two pages would bounce
// forever). Pass false for the visitors about to be redirected away.
export function useSyncMode(mode: AppMode, enabled = true) {
  const current = useModeStore(s => s.mode)
  const setMode = useModeStore(s => s.setMode)

  useEffect(() => {
    if (enabled && current !== mode) setMode(mode)
  }, [mode, enabled, current, setMode])
}
