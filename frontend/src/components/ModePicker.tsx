import { useNavigate } from 'react-router-dom'
import { useUser } from '@/stores/auth'
import { useModeStore, type AppMode } from '@/stores/mode'
import { MODES } from '@/lib/modes'

export default function ModePicker() {
  const navigate = useNavigate()
  const user = useUser()
  const setMode = useModeStore(s => s.setMode)

  const available = MODES.filter(m => !m.superuserOnly || user?.role === 'superuser')

  function choose(id: AppMode) {
    setMode(id)
    navigate(id === 'admin' ? '/admin' : '/')
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-16">
      <h1 className="text-2xl font-bold mb-2 text-center">Comment voulez-vous agir aujourd'hui ?</h1>
      <p className="text-sm text-muted-foreground text-center mb-10">
        Vous pourrez changer de mode à tout moment depuis la barre du haut.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {available.map(m => (
          <button
            key={m.id}
            onClick={() => choose(m.id)}
            className="text-left p-5 rounded-lg border bg-card hover:bg-accent/50 hover:border-primary/50 transition-colors"
          >
            <m.icon className="h-5 w-5 mb-3 text-primary" />
            <p className="font-semibold mb-1">{m.label}</p>
            <p className="text-sm text-muted-foreground">{m.description}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
