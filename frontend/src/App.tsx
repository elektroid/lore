import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import CampaignsPage from '@/pages/CampaignsPage'
import CampaignDetailPage from '@/pages/CampaignDetailPage'
import CampaignEntitiesPage from '@/pages/CampaignEntitiesPage'
import SettingsPage from '@/pages/SettingsPage'
import ProfilePage from '@/pages/ProfilePage'
import AdminPage from '@/pages/AdminPage'
import SynopsisPage from '@/pages/SynopsisPage'
import PrintPage from '@/pages/PrintPage'
import PlayPage from '@/pages/PlayPage'
import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'
import { useUIStore } from '@/stores/ui'
import { AuthProvider } from '@/components/AuthProvider'
import { ProtectedRoute } from '@/components/ProtectedRoute'

export default function App() {
  const theme = useUIStore((s) => s.theme)

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('dark', 'cyberpunk')
    if (theme === 'night') root.classList.add('dark')
    else if (theme === 'cyberpunk') root.classList.add('cyberpunk')
  }, [theme])

  return (
    <AuthProvider>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Protected routes */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <CampaignsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/campaigns/:id"
          element={
            <ProtectedRoute>
              <CampaignDetailPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/campaigns/:id/entities"
          element={
            <ProtectedRoute>
              <CampaignEntitiesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <ProfilePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <ProtectedRoute>
              <AdminPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/scenarios/:id/synopsis"
          element={
            <ProtectedRoute>
              <SynopsisPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/scenarios/:id/print"
          element={
            <ProtectedRoute>
              <PrintPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/scenarios/:id/play"
          element={
            <ProtectedRoute>
              <PlayPage />
            </ProtectedRoute>
          }
        />

        {/* Default redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  )
}
