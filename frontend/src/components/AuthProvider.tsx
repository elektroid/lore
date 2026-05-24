import { useEffect, useState } from 'react'
import { me } from '@/api/auth'
import { useAuthStore } from '@/stores/auth'
import { ProtectedRoute } from './ProtectedRoute'

export interface AuthProviderProps {
  children: React.ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [initialized, setInitialized] = useState(false)
  const loginStore = useAuthStore((s) => s.login)
  const logoutStore = useAuthStore((s) => s.logout)

  useEffect(() => {
    // Check if user is already logged in (tokens in cookies)
    const initializeAuth = async () => {
      try {
        const user = await me()
        loginStore(user)
      } catch {
        // Not authenticated or token expired
        logoutStore()
      } finally {
        setInitialized(true)
      }
    }

    initializeAuth()
  }, [loginStore, logoutStore])

  if (!initialized) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <ProtectedRoute.LoadingSpinner />
      </div>
    )
  }

  return <>{children}</>
}
