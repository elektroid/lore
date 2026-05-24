# Export PDF du scénario

## Vue d'ensemble

La fonctionnalité d'export PDF permet de générer un document imprimable du scénario complet pour jouer sans ordinateur. Le PDF est généré côté navigateur via `window.print()` depuis une page dédiée.

## Architecture

### Route et page

- **Route** : `/scenarios/:id/print`
- **Composant** : `frontend/src/pages/PrintPage.tsx`
- **Déclencheur** : bouton "Imprimer" dans `SynopsisPage.tsx`, ouvre dans un nouvel onglet

La page effectue toutes ses requêtes API au chargement, puis appelle `window.print()` après un délai de 400 ms (pour laisser les images se charger). Le navigateur ouvre sa boîte de dialogue d'impression native ; l'utilisateur peut imprimer sur papier ou enregistrer en PDF.

### Données chargées

| Endpoint | Contenu |
|---|---|
| `GET /scenarios/:id` | Nom, statut du scénario |
| `GET /campaigns/:id` | Nom de la campagne |
| `GET /scenarios/:id/synopsis` | Hook (synopsis), overview_cache |
| `GET /scenarios/:id/synopsis/npcs` | PNJs du synopsis |
| `GET /scenarios/:id/synopsis/scenes` | Scènes (avec PNJs et artefacts imbriqués) |

### Résolution des mentions

Le champ `hook.content` peut contenir des tokens `@[Nom](uuid)` (fonctionnalité @mention). La fonction `stripMentions()` dans `PrintPage.tsx` les convertit en `@Nom` pour le rendu en texte brut.

```ts
const MENTION_RE = /@\[([^\]]+)\]\([^)]+\)/g
function stripMentions(text: string): string {
  return text.replace(MENTION_RE, '@$1')
}
```

### Images

La première image de chaque PNJ (champ `images`, JSON array de `{id, url, label}`) est affichée en 72×72 px. Les URLs sont relatives (`/uploads/npcs/...`) et fonctionnent depuis la même origine que le frontend.

## Mise en page

### Sections (ordre fixe)

1. **En-tête** — nom campagne, nom scénario, date d'export
2. **Vue d'ensemble** — `synopsis.overview_cache` (si non vide)
3. **Synopsis** — `hook.content` parsé
4. **Personnages non-joueurs** — grille de cartes NPC (image + nom + rôle + description + motivation + réplique)
5. **Scènes** — liste ordonnée par `sort_order`, scènes uniquement (type `scene`, pas `divider`)

### Distinction visuelle des scènes

Chaque scène affiche un badge de statut :

| Statut | Badge | Couleur |
|---|---|---|
| `idea` | Idée | Gris |
| `optional_step` | Étape optionnelle | Jaune |
| `key_event` | Événement clé | Rouge |

Classes CSS : `.print-badge--idea`, `.print-badge--optional`, `.print-badge--key`

### CSS

Toutes les règles print sont dans `frontend/src/index.css` sous le commentaire `/* ── Print layout */`.

- **Écran** : aperçu avec bordure et ombre, centré, max 720px
- **Impression** (`@media print`) : fond blanc, padding retiré, tout sauf `#root` masqué
- **`page-break-inside: avoid`** sur `.print-npc-card` et `.print-scene` — les cartes ne sont jamais coupées entre deux pages

## Ajouter ou modifier du contenu

### Ajouter une nouvelle section

1. Ajouter la requête API dans `PrintPage.tsx` (pattern `useQuery` existant)
2. Ajouter le rendu JSX dans la section appropriée
3. Ajouter les classes CSS dans `index.css` sous `/* ── Print layout */`
4. Mettre à jour ce document

### Modifier le style d'une section existante

Toutes les classes print ont le préfixe `.print-`. Elles sont isolées et n'affectent pas le reste de l'application.

### Changer l'ordre des sections

Modifier l'ordre des blocs `<section>` dans `PrintPage.tsx`. L'ordre du DOM est l'ordre d'impression.

### Inclure des images d'artefacts

La logique est identique aux images NPC. Chaque `SceneArtefact` a un champ `images` (JSON array). Utiliser `firstImage(artefact.images)` et ajouter un `<img>` dans le rendu des artefacts de scène.

## Décisions de design

| Décision | Raison |
|---|---|
| `window.print()` côté frontend | Zéro dépendance backend, layout en React/CSS, portable |
| Page dédiée `/print` | Isolation complète du style print, pas de pollution du CSS de l'app |
| 400 ms de délai avant `print()` | Laisser les images se charger avant l'ouverture de la boîte de dialogue |
| Pas de saut de page par scène | Éviter le gaspillage de papier pour les scènes courtes |
| Fonte serif (Georgia) | Meilleure lisibilité à l'impression que les fontes sans-serif |
| Images NPC 72×72 px | Assez grande pour identifier un personnage, assez petite pour ne pas dominer la page |
| Tokens `@mention` strippés en `@Nom` | Le token brut `@[Nom](uuid)` est illisible à l'impression |
