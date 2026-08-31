import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { Shield, ShieldOff, ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import AppShell from '@/components/AppShell'
import { useDocTitle } from '@/hooks/useDocTitle'
import { api } from '@/api/client'
import { useUser } from '@/stores/auth'
import type { User } from '@/types/user'

interface PublicUser {
  id: string
  name: string
  email: string
  role: string
  created_at: string
}

interface AuditEvent {
  id: string
  created_at: string
  actor_id: string
  actor_name: string
  actor_email: string
  action: string
  target_type: string
  target_id: string
  target_label: string
  ip: string
}

interface AuditEventsPage {
  events: AuditEvent[]
  total: number
  page: number
  page_size: number
}

const AUDIT_PAGE_SIZE = 50

const auditActionLabels: Record<string, string> = {
  login: 'Connexion',
  login_failed: 'Connexion échouée',
  logout: 'Déconnexion',
  register: 'Inscription',
  role_promoted: 'Promu administrateur',
  role_demoted: 'Rétrogradé joueur',
  llm_config_updated: 'Config LLM modifiée',
  image_config_updated: "Config d'images modifiée",
  game_created: 'Jeu créé',
  game_updated: 'Jeu modifié',
  game_deleted: 'Jeu supprimé',
  lore_entity_created: 'Entité de connaissance créée',
  lore_entity_deleted: 'Entité de connaissance supprimée',
  sheet_template_created: 'Modèle de fiche créé',
  sheet_template_updated: 'Modèle de fiche modifié',
  sheet_template_deleted: 'Modèle de fiche supprimé',
}

function auditActionLabel(action: string) {
  return auditActionLabels[action] ?? action
}

function roleLabel(role: string) {
  return role === 'superuser' ? 'Admin' : 'Joueur'
}

function UserRow({ user, currentUserId }: { user: PublicUser; currentUserId: string }) {
  const queryClient = useQueryClient()

  const toggleRole = useMutation({
    mutationFn: (role: string) =>
      api.put<User>(`/users/${user.id}/role`, { role }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  })

  const nextRole = user.role === 'superuser' ? 'player' : 'superuser'
  const isSelf = user.id === currentUserId

  return (
    <li className="flex items-center gap-4 py-3 border-b last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{user.name}</p>
        <p className="text-xs text-muted-foreground truncate">{user.email}</p>
      </div>
      <span className={`text-xs px-2 py-0.5 rounded-full border shrink-0 ${
        user.role === 'superuser'
          ? 'bg-primary/10 text-primary border-primary/30'
          : 'bg-muted text-muted-foreground border-border'
      }`}>
        {roleLabel(user.role)}
      </span>
      <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
        {new Date(user.created_at).toLocaleDateString('fr-FR')}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 h-7 px-2 text-xs"
        disabled={toggleRole.isPending || isSelf}
        title={isSelf ? 'Impossible de modifier votre propre rôle' : `Passer en ${roleLabel(nextRole)}`}
        onClick={() => toggleRole.mutate(nextRole)}
      >
        {nextRole === 'superuser'
          ? <Shield className="h-3.5 w-3.5" />
          : <ShieldOff className="h-3.5 w-3.5" />
        }
      </Button>
    </li>
  )
}

function UsersTab({ currentUserId }: { currentUserId: string }) {
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<PublicUser[]>('/users'),
  })

  return (
    <>
      {isLoading && (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      )}

      {!isLoading && users.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucun utilisateur.</p>
      )}

      {users.length > 0 && (
        <>
          <div className="flex items-center gap-4 pb-2 text-xs text-muted-foreground font-medium uppercase tracking-wide border-b mb-1">
            <span className="flex-1">Utilisateur</span>
            <span className="shrink-0">Rôle</span>
            <span className="shrink-0 hidden sm:block">Inscription</span>
            <span className="shrink-0 w-14"></span>
          </div>
          <ul>
            {users.map(u => (
              <UserRow key={u.id} user={u} currentUserId={currentUserId} />
            ))}
          </ul>
        </>
      )}
    </>
  )
}

function AuditLogTab() {
  const [action, setAction] = useState('')
  const [page, setPage] = useState(1)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit-log', action, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), page_size: String(AUDIT_PAGE_SIZE) })
      if (action) params.set('action', action)
      return api.get<AuditEventsPage>(`/audit-log?${params.toString()}`)
    },
  })

  const events = data?.events ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE))

  return (
    <>
      <div className="mb-4">
        <select
          value={action}
          onChange={e => { setAction(e.target.value); setPage(1) }}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">Tous les événements</option>
          {Object.entries(auditActionLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {isLoading && (
        <p className="text-sm text-muted-foreground">Chargement…</p>
      )}

      {!isLoading && events.length === 0 && (
        <p className="text-sm text-muted-foreground">Aucun événement.</p>
      )}

      {events.length > 0 && (
        <ul className="divide-y">
          {events.map(e => (
            <li key={e.id} className="py-2.5 flex items-start gap-3 text-sm">
              <span className="text-xs text-muted-foreground shrink-0 w-36 tabular-nums">
                {new Date(e.created_at).toLocaleString('fr-FR')}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate">
                  <span className="font-medium">{e.actor_name || e.actor_email || 'inconnu'}</span>
                  {' — '}
                  {auditActionLabel(e.action)}
                  {e.target_label && <span className="text-muted-foreground"> · {e.target_label}</span>}
                </p>
              </div>
              <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">{e.ip}</span>
            </li>
          ))}
        </ul>
      )}

      {total > 0 && (
        <div className="flex items-center justify-between mt-4 text-sm text-muted-foreground">
          <span>Page {page} sur {totalPages} ({total} événements)</span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="p-1.5 rounded hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export default function AdminPage() {
  useDocTitle('lore: administration')
  const currentUser = useUser()

  if (currentUser && currentUser.role !== 'superuser') {
    return <Navigate to="/" replace />
  }

  return (
    <AppShell crumbs={[{ label: 'Administration' }]}>
      <main className="max-w-2xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold mb-8">Administration</h1>

        <Tabs defaultValue="users">
          <TabsList className="mb-6">
            <TabsTrigger value="users">Utilisateurs</TabsTrigger>
            <TabsTrigger value="audit-log">Journal</TabsTrigger>
          </TabsList>
          <TabsContent value="users">
            <UsersTab currentUserId={currentUser?.id ?? ''} />
          </TabsContent>
          <TabsContent value="audit-log">
            <AuditLogTab />
          </TabsContent>
        </Tabs>
      </main>
    </AppShell>
  )
}
