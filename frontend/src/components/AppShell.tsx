import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ChevronRight, Sun, Moon, Zap, Settings, UserCircle, Users, Dices, ClipboardList, LogOut, ChevronDown, Check } from 'lucide-react'
import { useUIStore, type Theme } from '@/stores/ui'
import { useAuthStore, useUser } from '@/stores/auth'
import { useModeStore, type AppMode } from '@/stores/mode'
import { MODES, modeInfo, modeHomePath } from '@/lib/modes'
import { logout as logoutRequest } from '@/api/auth'
import { api } from '@/api/client'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu'

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
  const mode = useModeStore((s) => s.mode)
  const setMode = useModeStore((s) => s.setMode)
  const navigate = useNavigate()
  const currentMode = modeInfo(mode)
  const availableModes = MODES.filter(m => !m.superuserOnly || user?.role === 'superuser')

  // Icons only relevant to some modes — see docs/users.md's per-persona split.
  // Jeux/Fiches de personnage are catalog-management surfaces: an author
  // picks a game system and, once relevant, its templates; an admin manages
  // both. Neither belongs to the Meneur or Joueur workflow. Admin/Paramètres
  // stay role-gated on top, unchanged.
  const showGames = mode === 'author' || mode === 'admin'
  const showSheetTemplates = mode === 'admin'
  const showAdminLink = user?.role === 'superuser' && mode === 'admin'
  const showSettingsLink = user?.role === 'superuser' && mode === 'admin'

  async function handleLogout() {
    try {
      await logoutRequest()
    } finally {
      clearAuth()
      setMode(null)
      navigate('/login')
    }
  }

  function handleChooseMode(id: AppMode) {
    setMode(id)
    navigate(modeHomePath(id))
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b px-6 py-3 flex items-center gap-2 gap-y-2 text-sm flex-wrap">
        <Link to="/" className="font-semibold hover:text-foreground text-foreground">
          Lore Engine
        </Link>
        <VersionBadge />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              title="Changer de mode"
              className="flex items-center gap-1.5 text-xs pl-2 pr-1.5 py-1 rounded-full border bg-muted/40 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              {currentMode ? (
                <>
                  <currentMode.icon className="h-3 w-3" />
                  {currentMode.label}
                </>
              ) : (
                'Choisir un mode'
              )}
              <ChevronDown className="h-3 w-3 opacity-60" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {availableModes.map(m => (
              <DropdownMenuItem key={m.id} onSelect={() => handleChooseMode(m.id)}>
                <m.icon className="h-3.5 w-3.5" />
                {m.label}
                {mode === m.id && <Check className="h-3.5 w-3.5 ml-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
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
        <TooltipProvider delayDuration={200}>
          <div className="ml-auto flex items-center gap-1">
            {showGames && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to="/games"
                    aria-label="Jeux"
                    className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <Dices className="h-3.5 w-3.5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>Jeux</TooltipContent>
              </Tooltip>
            )}
            {showSheetTemplates && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to="/sheet-templates"
                    aria-label="Fiches de personnage"
                    className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <ClipboardList className="h-3.5 w-3.5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>Fiches de personnage</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  to="/profile"
                  aria-label="Mon profil"
                  className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  <UserCircle className="h-3.5 w-3.5" />
                </Link>
              </TooltipTrigger>
              <TooltipContent>Mon profil</TooltipContent>
            </Tooltip>
            {showAdminLink && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to="/admin"
                    aria-label="Administration"
                    className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <Users className="h-3.5 w-3.5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>Administration</TooltipContent>
              </Tooltip>
            )}
            {showSettingsLink && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Link
                    to="/settings"
                    aria-label="Paramètres"
                    className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </Link>
                </TooltipTrigger>
                <TooltipContent>Paramètres</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleLogout}
                  aria-label="Se déconnecter"
                  className="p-1.5 rounded transition-colors text-muted-foreground hover:text-foreground hover:bg-muted"
                >
                  <LogOut className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Se déconnecter</TooltipContent>
            </Tooltip>
            <div className="w-px h-4 bg-border mx-1" />
            {themes.map((t) => (
              <Tooltip key={t.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setTheme(t.id)}
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
                </TooltipTrigger>
                <TooltipContent>{t.label}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </TooltipProvider>
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
