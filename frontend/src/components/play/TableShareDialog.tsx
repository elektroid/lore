import { useState } from 'react'
import { Check, Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/**
 * The two links a session hands out. Both carry the same token — the difference
 * is only which surface it opens. See docs/play-table.md.
 */
export default function TableShareDialog({
  token, onClose, onRegenerate, regenerating,
}: {
  token: string
  onClose: () => void
  onRegenerate: () => void
  regenerating?: boolean
}) {
  const origin = window.location.origin
  const tableUrl = `${origin}/table/${token}`
  const playerUrl = `${tableUrl}/player`

  return (
    <Dialog open onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Partager la table</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-1">
          <LinkRow
            label="Écran de table"
            hint="À ouvrir en plein écran sur la TV, le vidéoprojecteur ou un second moniteur. Lecture seule."
            url={tableUrl}
          />
          <LinkRow
            label="Lien joueur"
            hint="À envoyer aux joueurs — téléphone à table ou navigateur à distance. Ils voient la projection et lancent leurs dés."
            url={playerUrl}
          />

          <div className="pt-3 border-t space-y-2">
            <p className="text-xs text-muted-foreground">
              Régénérer le lien invalide immédiatement toutes les adresses déjà partagées
              pour cette session.
            </p>
            <Button
              variant="outline" size="sm" className="h-8 text-xs"
              disabled={regenerating}
              onClick={() => {
                if (confirm('Régénérer le lien ? Les adresses déjà partagées cesseront de fonctionner.')) {
                  onRegenerate()
                }
              }}
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${regenerating ? 'animate-spin' : ''}`} />
              Régénérer le lien
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function LinkRow({ label, hint, url }: { label: string; hint: string; url: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard needs a secure context — the URL is selectable in the field either way.
    }
  }

  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="flex gap-1.5">
        <input
          readOnly
          value={url}
          onFocus={e => e.currentTarget.select()}
          className="h-9 flex-1 rounded-md border border-input bg-muted/40 px-2.5 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <Button variant="outline" size="sm" className="h-9 w-9 p-0 shrink-0" onClick={copy} title="Copier">
          {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title="Ouvrir dans un nouvel onglet"
          className="h-9 w-9 shrink-0 inline-flex items-center justify-center rounded-md border border-input hover:bg-accent transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  )
}
