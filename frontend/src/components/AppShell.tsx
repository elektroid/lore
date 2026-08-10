import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Sun, Moon, Zap, Settings, UserCircle, Users, Dices, LogOut } from 'lucide-react'
import { useUIStore, type Theme } from '@/stores/ui'
import { useAuthStore, useUser } from '@/stores/auth'
import { logout as logoutRequest } from '@/api/auth'
import { api } from '@/api/client'

interface Crumb {
  label: string
  to?: string
  onClick?: () => void
}

interface ModeTab {
  label: string
  to: string
  active: boolean
}

interface AppShellProps {
  crumbs?: Crumb[]
  modeTabs?: ModeTab[]
  children: React.ReactNode
}

const themes: { id: Theme; icon: React.ReactNode; label: string }[] = [
  { id: 'daylight', icon: <Sun className="h-3.5 w-3.5" />, label: 'Clair' },
  { id: 'night',    icon: <Moon className="h-3.5 w-3.5" />, label: 'Sombre' },
  { id: 'cyberpunk', icon: <Zap className="h-3.5 w-3.5" />, label: 'Cyberpunk' },
]

interface VersionInfo {
  version: string
  commit: string
  build_time: string
}

function VersionBadge() {
  const { data } = useQuery({
    queryKey: ['version'],
    queryFn: () => api.get<VersionInfo>('/version'),
    staleTime: Infinity,
  })
  if (!data) return null

  const title = data.version === 'dev'
    ? 'build local — non déployée'
    : [data.commit, data.build_time].filter(Boolean).join(' — ')

  return (
    <span
      title={title}
      className="font-mono text-[10px] text-muted-foreground/70 hover:text-muted-foreground select-all"
    >
      {data.version}
    </span>
  )
}

export default function AppShell({ crumbs = [], modeTabs, children }: AppShellProps) {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const user = useUser()
  const clearAuth = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  async function handleLogout() {
    try {
      await logoutRequest()
    } finally {
      clearAuth()
      navigate('/login')
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-3 flex items-center gap-2 gap-y-2 text-sm flex-wrap">
        <Link to="/" className="font-semibold hover:text-foreground text-foreground">
          Lore Engine
        </Link>
        <VersionBadge />
        {crumbs.map((crumb, i) => (
          <span key={i} className="flex items-center gap-2 text-muted-foreground">
            <ChevronRight className="h-3.5 w-3.5" />
            {crumb.to ? (
              <Link to={crumb.to} className="hover:text-foreground transition-colors">
                {crumb.label}
              </Link>
            ) : crumb.onClick ? (
              <button onClick={crumb.onClick} className="hover:text-foreground transition-colors">
                {crumb.label}
              </button>
            ) : (
              <span className="text-foreground">{crumb.label}</span>
            )}
          </span>
        ))}
        <div className="ml-auto flex items-center gap-1">
          <Link
            to="/games"
            title="Jeux"
            aria-label="Jeux"
            className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <Dices className="h-3.5 w-3.5" />
          </Link>
          <Link
            to="/profile"
            title="Mon profil"
            aria-label="Mon profil"
            className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <UserCircle className="h-3.5 w-3.5" />
          </Link>
          {user?.role === 'superuser' && (
            <Link
              to="/admin"
              title="Administration"
              aria-label="Administration"
              className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <Users className="h-3.5 w-3.5" />
            </Link>
          )}
          {user?.role === 'superuser' && (
            <Link
              to="/settings"
              title="Paramètres"
              aria-label="Paramètres"
              className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <Settings className="h-3.5 w-3.5" />
            </Link>
          )}
          <button
            onClick={handleLogout}
            title="Se déconnecter"
            aria-label="Se déconnecter"
            className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
          <div className="w-px h-4 bg-border mx-1" />
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              title={t.label}
              aria-label={`Thème ${t.label}`}
              aria-pressed={theme === t.id}
              className={`p-1.5 rounded transition-colors ${
                theme === t.id
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {t.icon}
            </button>
          ))}
        </div>
      </header>
      {modeTabs && modeTabs.length > 0 && (
        <div className="border-b px-6 py-2">
          <div className="inline-flex rounded-md border p-0.5 bg-muted/40">
            {modeTabs.map((tab) => (
              <Link
                key={tab.to}
                to={tab.to}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  tab.active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </Link>
            ))}
          </div>
        </div>
      )}
      {children}
    </div>
  )
}
