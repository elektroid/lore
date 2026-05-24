import { useEffect } from 'react'

export function useDocTitle(title: string) {
  useEffect(() => {
    document.title = title
    return () => { document.title = 'lore' }
  }, [title])
}
