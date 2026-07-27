import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import CampaignsPage from '@/pages/CampaignsPage'
import CampaignDetailPage from '@/pages/CampaignDetailPage'
import CampaignEntitiesPage from '@/pages/CampaignEntitiesPage'
import ScenarioFactoryPage from '@/pages/ScenarioFactoryPage'
import SettingsPage from '@/pages/SettingsPage'
import ProfilePage from '@/pages/ProfilePage'
import AdminPage from '@/pages/AdminPage'
import SynopsisPage from '@/pages/SynopsisPage'
import PrintPage from '@/pages/PrintPage'
import PlayPage from '@/pages/PlayPage'
import TablePage from '@/pages/TablePage'
import PlayerSeatPage from '@/pages/PlayerSeatPage'
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

        {/* Table surface — the share token in the URL is the credential, because
            the projection screen is usually a TV nobody logs in on.
            See docs/play-table.md. */}
        <Route path="/table/:token" element={<TablePage />} />
        <Route path="/table/:token/player" element={<PlayerSeatPage />} />

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
        {/* Scenario factory — see docs/scenario-factory.md */}
        <Route
          path="/campaigns/:id/factory"
          element={
            <ProtectedRoute>
              <ScenarioFactoryPage />
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
