import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { resetPassword } from '@/api/auth'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token') || ''

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError('Les mots de passe ne correspondent pas')
      return
    }
    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères')
      return
    }

    setLoading(true)
    try {
      await resetPassword(token, password)
      setDone(true)
      setTimeout(() => navigate('/login', { replace: true }), 2000)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la réinitialisation')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-lg border p-8 shadow-xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold">Lore Engine</h1>
            <p className="text-muted-foreground mt-2">Nouveau mot de passe</p>
          </div>

          {!token ? (
            <div className="bg-destructive/10 text-destructive border border-destructive/30 rounded-md p-3 text-sm">
              Lien invalide — vérifiez que vous avez copié l'adresse complète
              depuis l'email, ou demandez un{' '}
              <a href="/forgot-password" className="underline font-medium">
                nouveau lien
              </a>
              .
            </div>
          ) : done ? (
            <div className="bg-primary/10 text-sm rounded-md p-4 text-center">
              Mot de passe mis à jour. Redirection vers la connexion…
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              {error && (
                <div className="bg-destructive/10 text-destructive border border-destructive/30 rounded-md p-3 text-sm">
                  {error}
                </div>
              )}

              <div>
                <label htmlFor="password" className="block text-sm font-medium mb-2">
                  Nouveau mot de passe
                </label>
                <input
                  type="password"
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full rounded-md border border-input bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="••••••••"
                  disabled={loading}
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium mb-2">
                  Confirmer le mot de passe
                </label>
                <input
                  type="password"
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full rounded-md border border-input bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  placeholder="••••••••"
                  disabled={loading}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Mise à jour…' : 'Réinitialiser le mot de passe'}
              </button>
            </form>
          )}

          <div className="mt-6 text-center text-sm">
            <a href="/login" className="text-primary hover:underline font-medium">
              Retour à la connexion
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}
