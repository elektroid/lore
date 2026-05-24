import { Link } from 'react-router-dom'
import { ChevronRight, Sun, Moon, Zap, Settings, UserCircle, Users } from 'lucide-react'
import { useUIStore, type Theme } from '@/stores/ui'
import { useUser } from '@/stores/auth'

interface Crumb {
  label: string
  to?: string
  onClick?: () => void
}

interface AppShellProps {
  crumbs?: Crumb[]
  children: React.ReactNode
}

const themes: { id: Theme; icon: React.ReactNode; label: string }[] = [
  { id: 'daylight', icon: <Sun className="h-3.5 w-3.5" />, label: 'Daylight' },
  { id: 'night',    icon: <Moon className="h-3.5 w-3.5" />, label: 'Night' },
  { id: 'cyberpunk', icon: <Zap className="h-3.5 w-3.5" />, label: 'Cyberpunk' },
]

export default function AppShell({ crumbs = [], children }: AppShellProps) {
  const theme = useUIStore((s) => s.theme)
  const setTheme = useUIStore((s) => s.setTheme)
  const user = useUser()

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-3 flex items-center gap-2 text-sm">
        <Link to="/" className="font-semibold hover:text-foreground text-foreground">
          Lore Engine
        </Link>
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
            to="/profile"
            title="Mon profil"
            className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <UserCircle className="h-3.5 w-3.5" />
          </Link>
          {user?.role === 'superuser' && (
            <Link
              to="/admin"
              title="Administration"
              className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <Users className="h-3.5 w-3.5" />
            </Link>
          )}
          <Link
            to="/settings"
            title="Paramètres"
            className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
          >
            <Settings className="h-3.5 w-3.5" />
          </Link>
          <div className="w-px h-4 bg-border mx-1" />
          {themes.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              title={t.label}
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
      {children}
    </div>
  )
}
