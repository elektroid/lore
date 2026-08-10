import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download } from 'lucide-react'
import { Button } from '@/components/ui/button'
import AppShell from '@/components/AppShell'
import { api } from '@/api/client'
import { useDocTitle } from '@/hooks/useDocTitle'
import { useUser } from '@/stores/auth'
import type { ArchivedCampaign } from '@/types/campaign'

export default function ArchivesPage() {
  useDocTitle('lore: archives')
  const navigate = useNavigate()
  const user = useUser()
  const isSuperuser = user?.role === 'superuser'

  const { data: archives = [], isLoading, error } = useQuery({
    queryKey: ['archived-campaigns'],
    queryFn: () => api.get<ArchivedCampaign[]>('/archived-campaigns'),
  })

  return (
    <AppShell crumbs={[{ label: 'Campagnes', to: '/' }, { label: 'Archives' }]}>
      <main className="px-6 py-8 max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold">Archives</h2>
            <p className="text-sm text-muted-foreground">
              Campagnes archivées : retirées de la liste des campagnes actives,
              conservées ici sous forme de snapshot téléchargeable.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate('/')}>
            Retour aux campagnes
          </Button>
        </div>

        {isLoading && <p className="text-muted-foreground text-sm">Chargement…</p>}
        {error && <p className="text-destructive text-sm">Erreur : {error.message}</p>}

        {!isLoading && !error && archives.length === 0 && (
          <p className="text-muted-foreground text-sm">Aucune campagne archivée.</p>
        )}

        {!isLoading && !error && archives.length > 0 && (
          <ul className="space-y-2">
            {archives.map(a => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 p-4 rounded-lg border bg-card"
              >
                <div className="min-w-0">
                  <p className="font-medium truncate">{a.name}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {a.game_name}
                    {isSuperuser && a.owner_name && ` · ${a.owner_name}`}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <p className="text-xs text-muted-foreground">
                    Archivée le {new Date(a.archived_at).toLocaleDateString('fr-FR')}
                  </p>
                  <a
                    href={`/api/archived-campaigns/${a.id}/export`}
                    className="inline-flex items-center gap-1 text-xs h-8 px-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Télécharger
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </AppShell>
  )
}
