import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from 'react-router-dom'
import { Shield, ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
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

export default function AdminPage() {
  useDocTitle('lore: administration')
  const currentUser = useUser()

  if (currentUser && currentUser.role !== 'superuser') {
    return <Navigate to="/" replace />
  }

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['admin-users'],
    queryFn: () => api.get<PublicUser[]>('/users'),
  })

  return (
    <AppShell crumbs={[{ label: 'Administration' }]}>
      <main className="max-w-2xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold mb-8">Utilisateurs</h1>

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
                <UserRow key={u.id} user={u} currentUserId={currentUser?.id ?? ''} />
              ))}
            </ul>
          </>
        )}
      </main>
    </AppShell>
  )
}
