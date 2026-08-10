import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useUnsavedGuard } from '@/hooks/useUnsavedGuard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import AppShell from '@/components/AppShell'
import { useDocTitle } from '@/hooks/useDocTitle'
import { api } from '@/api/client'
import { useAuthStore, useUser } from '@/stores/auth'
import type { User } from '@/types/user'

interface UpdateMeRequest {
  name: string
  email: string
  current_password?: string
  new_password?: string
}

interface UpdateMeResponse {
  user: User
}

export default function ProfilePage() {
  useDocTitle('lore: profil')
  const user = useUser()
  const setUser = useAuthStore((s) => s.setUser)

  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const update = useMutation({
    mutationFn: (req: UpdateMeRequest) =>
      api.put<UpdateMeResponse>('/auth/me', req),
    onSuccess: (data) => {
      setUser(data.user)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordError(null)
      setSuccess(true)
      setTimeout(() => setSuccess(false), 3000)
    },
  })

  const dirty = name !== (user?.name ?? '') || email !== (user?.email ?? '') || newPassword !== ''
  const { guardDialog } = useUnsavedGuard(dirty, async () => {
    if (newPassword && newPassword !== confirmPassword) throw new Error('mismatch')
    const req: UpdateMeRequest = { name, email }
    if (newPassword) { req.current_password = currentPassword; req.new_password = newPassword }
    await update.mutateAsync(req)
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPasswordError(null)

    if (newPassword && newPassword !== confirmPassword) {
      setPasswordError('Les mots de passe ne correspondent pas')
      return
    }

    const req: UpdateMeRequest = { name, email }
    if (newPassword) {
      req.current_password = currentPassword
      req.new_password = newPassword
    }
    update.mutate(req)
  }

  return (
    <AppShell crumbs={[{ label: 'Profil' }]}>
      <main className="max-w-lg mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold mb-8">Mon profil</h1>

        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Identity */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Identité</h2>

            <div className="space-y-2">
              <Label htmlFor="name">Nom</Label>
              <Input
                id="name"
                value={name}
                onChange={e => setName(e.target.value)}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
            </div>
          </section>

          {/* Password */}
          <section className="space-y-4">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Mot de passe
              <span className="ml-2 font-normal normal-case text-xs">(laisser vide pour ne pas changer)</span>
            </h2>

            <div className="space-y-2">
              <Label htmlFor="current-password">Mot de passe actuel</Label>
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="new-password">Nouveau mot de passe</Label>
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirmer le nouveau mot de passe</Label>
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
              />
            </div>

            {passwordError && (
              <p className="text-destructive text-sm">{passwordError}</p>
            )}
          </section>

          <div className="flex items-center gap-3">
            {update.error && (
              <p className="text-destructive text-sm flex-1">{update.error.message}</p>
            )}
            {success && (
              <p className="text-sm text-green-600 flex-1">Profil mis à jour.</p>
            )}
            <Button type="submit" disabled={update.isPending} className="ml-auto">
              {update.isPending ? 'Enregistrement…' : 'Enregistrer'}
            </Button>
          </div>
        </form>

        <div className="mt-10 pt-6 border-t text-xs text-muted-foreground space-y-1">
          <p>Rôle : <span className="font-medium">{user?.role}</span></p>
          <p>Compte créé le : <span className="font-medium">{user?.created_at ? new Date(user.created_at).toLocaleDateString('fr-FR') : '—'}</span></p>
        </div>
      </main>
      {guardDialog}
    </AppShell>
  )
}
