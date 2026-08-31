import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import CampaignsPage from '@/pages/CampaignsPage'
import ArchivesPage from '@/pages/ArchivesPage'
import CampaignDetailPage from '@/pages/CampaignDetailPage'
import CampaignEntitiesPage from '@/pages/CampaignEntitiesPage'
import GameMasterPage from '@/pages/GameMasterPage'
import RunPlayerPage from '@/pages/RunPlayerPage'
import ScenarioFactoryPage from '@/pages/ScenarioFactoryPage'
import SettingsPage from '@/pages/SettingsPage'
import ProfilePage from '@/pages/ProfilePage'
import AdminPage from '@/pages/AdminPage'
import GamesPage from '@/pages/GamesPage'
import SheetTemplatesPage from '@/pages/SheetTemplatesPage'
import SheetTemplateEditorPage from '@/pages/SheetTemplateEditorPage'
import LorePage from '@/pages/LorePage'
import SynopsisPage from '@/pages/SynopsisPage'
import PrintPage from '@/pages/PrintPage'
import PlayPage from '@/pages/PlayPage'
import TablePage from '@/pages/TablePage'
import PlayerSeatPage from '@/pages/PlayerSeatPage'
import LoginPage from '@/pages/LoginPage'
import RegisterPage from '@/pages/RegisterPage'
import ForgotPasswordPage from '@/pages/ForgotPasswordPage'
import ResetPasswordPage from '@/pages/ResetPasswordPage'
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
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />

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
          path="/campaigns/archives"
          element={
            <ProtectedRoute>
              <ArchivesPage />
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
        {/* Gamemaster hub — prepare and manage the groups playing this campaign */}
        <Route
          path="/campaigns/:id/runs"
          element={
            <ProtectedRoute>
              <GameMasterPage />
            </ProtectedRoute>
          }
        />
        {/* Player mode — a seated player's own view of one run */}
        <Route
          path="/runs/:runId"
          element={
            <ProtectedRoute>
              <RunPlayerPage />
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
          path="/lore"
          element={
            <ProtectedRoute>
              <LorePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/games"
          element={
            <ProtectedRoute>
              <GamesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sheet-templates"
          element={
            <ProtectedRoute>
              <SheetTemplatesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/sheet-templates/:id"
          element={
            <ProtectedRoute>
              <SheetTemplateEditorPage />
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
