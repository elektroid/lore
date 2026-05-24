import { Navigate, useLocation } from 'react-router-dom'
import { useIsAuthenticated, useAuthLoading } from '@/stores/auth'

interface ProtectedRouteProps {
  children: React.ReactNode
  requiredRole?: 'superuser' | 'player'
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const isAuthenticated = useIsAuthenticated()
  const isLoading = useAuthLoading()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <LoadingSpinner />
      </div>
    )
  }

  if (!isAuthenticated) {
    // Redirect to login page, but save the current location for redirect after login
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  // If a specific role is required, check it
  // Note: This is a placeholder - you'll need to implement role checking
  // based on your user store
  // const user = useUser()
  // if (requiredRole && user?.role !== requiredRole && user?.role !== 'superuser') {
  //   return <Navigate to="/" replace />
  // }

  return <>{children}</>
}

// Simple loading spinner component
// You can replace this with your existing spinner
function LoadingSpinner() {
  return (
    <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
  )
}

ProtectedRoute.LoadingSpinner = LoadingSpinner
