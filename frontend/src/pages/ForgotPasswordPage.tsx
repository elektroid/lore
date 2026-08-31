import { useState } from 'react'
import { forgotPassword } from '@/api/auth'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await forgotPassword(email)
      // Same message regardless of whether the address is registered — the
      // backend never reveals that, so the frontend can't either.
      setSent(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Échec de la demande')
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
            <p className="text-muted-foreground mt-2">Mot de passe oublié</p>
          </div>

          {sent ? (
            <div className="bg-primary/10 text-sm rounded-md p-4 text-center">
              Si un compte existe avec cet email, un lien de réinitialisation
              vient d'être envoyé. Vérifiez votre boîte de réception.
            </div>
          ) : (
            <>
              {error && (
                <div className="bg-destructive/10 text-destructive border border-destructive/30 rounded-md p-3 mb-6 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full rounded-md border border-input bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                    placeholder="vous@exemple.com"
                    disabled={loading}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-md bg-primary text-primary-foreground py-2 text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Envoi…' : 'Envoyer le lien de réinitialisation'}
                </button>
              </form>
            </>
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
