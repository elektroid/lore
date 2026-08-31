import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { Shield, ShieldOff, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AppShell from '@/components/AppShell'
import { useDocTitle } from '@/hooks/useDocTitle'
import { useSyncMode } from '@/hooks/useSyncMode'
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

interface NewUserForm {
  name: string
  email: string
  password: string
  role: string
}

const emptyNewUserForm: NewUserForm = { name: '', email: '', password: '', role: 'player' }

function CreateUserDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<NewUserForm>(emptyNewUserForm)

  const create = useMutation({
    mutationFn: (data: NewUserForm) => api.post<PublicUser>('/users', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      onOpenChange(false)
      setForm(emptyNewUserForm)
    },
  })

  function field(key: keyof NewUserForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }))
  }

  return (
    <Dialog open={open} onOpenChange={o => { onOpenChange(o); if (!o) setForm(emptyNewUserForm) }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouvel utilisateur</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={e => { e.preventDefault(); create.mutate(form) }}
          className="space-y-4 mt-2"
        >
          <div className="space-y-2">
            <Label htmlFor="name">Nom *</Label>
            <Input id="name" value={form.name} onChange={field('name')} autoFocus />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email *</Label>
            <Input id="email" type="email" value={form.email} onChange={field('email')} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Mot de passe *</Label>
            <Input id="password" type="text" value={form.password} onChange={field('password')} placeholder="8 caractères minimum" />
            <p className="text-xs text-muted-foreground">
              Communiquez-le vous-même — il n'y a pas d'email d'invitation.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="role">Rôle</Label>
            <select
              id="role"
              value={form.role}
              onChange={field('role')}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            >
              <option value="player">Joueur</option>
              <option value="superuser">Admin</option>
            </select>
          </div>
          {create.error && (
            <p className="text-destructive text-sm">{create.error.message}</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Annuler</Button>
            <Button
              type="submit"
              disabled={!form.name.trim() || !form.email.trim() || form.password.length < 8 || create.isPending}
            >
              {create.isPending ? 'Création…' : 'Créer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function UsersTab({ currentUserId }: { currentUserId: string }) {
  const [creating, setCreating] = useState(false)
  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<PublicUser[]>('/users'),
  })

  return (
    <>
      <div className="flex items-center justify-end mb-4">
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />Nouvel utilisateur
        </Button>
      </div>

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

      <CreateUserDialog open={creating} onOpenChange={setCreating} />
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
  useSyncMode('admin', currentUser?.role === 'superuser')

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
