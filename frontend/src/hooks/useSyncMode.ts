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
//
// Deliberately reads the store's current value imperatively (getState())
// rather than subscribing to it: subscribing would re-run this effect on
// every mode change, including the one *this same page* is about to be
// navigated away from — e.g. picking "Meneur de jeu" from the dropdown
// while still mounted on an author page would set mode='gamemaster', which
// would re-fire this effect before the navigation unmounts the page, and
// it would "correct" the mode straight back to 'author'. Keying the effect
// only on [mode, enabled] means it fires once on arrival (or when campaign
// ownership resolves), not on every subsequent store change.
export function useSyncMode(mode: AppMode, enabled = true) {
  const setMode = useModeStore(s => s.setMode)

  useEffect(() => {
    if (enabled && useModeStore.getState().mode !== mode) setMode(mode)
  }, [mode, enabled, setMode])
}
