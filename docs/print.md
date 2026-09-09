# Impression — le livre de campagne

Deux documents, une seule maquette :

| | Route | Ce qu'il répond |
|---|---|---|
| **Campagne** | `/campaigns/:id/print` | *Qu'est-ce que cette campagne ?* — le pitch, tous les scénarios dans l'ordre, et l'intégralité de la distribution, des lieux, des factions et des artefacts, avec leurs images. |
| **Scénario** | `/scenarios/:id/print` | *Qu'est-ce que je mène ce soir ?* — un scénario, et seulement les entités qu'il utilise. |

Les deux passent par `window.print()`. Le navigateur imprime sur papier ou
enregistre en PDF ; il n'y a pas de générateur PDF côté serveur, donc rien à
maintenir en plus du CSS.

`?auto=0` sur l'une ou l'autre route ouvre le document sans déclencher la boîte
de dialogue — pour le relire avant d'imprimer, et pour les tests.

## Une seule requête

`GET /api/campaigns/:id/print` (voir `backend/internal/handlers/campaign_print.go`)
renvoie tout le livre d'un coup : campagne, scénarios avec synopsis et scènes,
et les quatre listes d'entités.

C'est délibéré. Assembler le document depuis les endpoints existants demanderait
une requête par scénario multipliée par quatre types d'entités, sur une page qui
doit être **entièrement peinte** avant `window.print()`. Une seule charge utile
supprime toute une classe de « le PDF est sorti avec la moitié des portraits
manquants ».

La page du scénario lit le même document et le réduit à un chapitre, plutôt que
d'entretenir un deuxième jeu de requêtes et une deuxième maquette. C'est aussi
comme ça qu'elle a gagné ses images.

L'accès est `requireCampaignAccess`, pas `requireCampaignOwner` : un meneur
délégué qui imprime la campagne pour la mener, c'est exactement l'usage.

## Le noir et blanc d'abord

**Chrome livre sa boîte de dialogue avec « Graphiques d'arrière-plan »
décoché, et `print-color-adjust: exact` ne survit pas au décochage.** Tout ce
qui est construit en aplats de couleur sort donc en rectangles blancs chez la
plupart des gens, la plupart du temps.

Conséquence sur la maquette (`frontend/src/print/print.css`) :

- la structure est faite de filets, de bordures et de graisses typographiques,
  jamais de fonds pleins ;
- les badges sont **cernés**, pas remplis ;
- chaque image est une vraie balise `<img>`, jamais un `background-image` ;
- la couleur est un bonus quand elle survit, jamais porteuse de sens.

## Pas d'en-tête ni de pied de page courants

Chrome n'implémente pas les *margin boxes* de `@page`, et l'astuce très
répandue d'un élément `position: fixed` qui se répéterait à chaque page
**ne fonctionne pas** : testé contre le moteur d'impression de Chrome, il
s'est affiché une seule fois, en haut d'une page arbitraire, par-dessus le
titre du chapitre. Un pied de page qui atterrit au milieu du texte est bien
pire que pas de pied de page. La boîte de dialogue du navigateur sait ajouter
les numéros de page ; c'est l'endroit fiable pour ça.

## Ce qui casse une mise en page, et ce qui la répare

| Problème | Règle |
|---|---|
| Un titre de scène seul en bas de page | `break-after: avoid` sur `.doc-scene__head` |
| Une scène longue poussée entière à la page suivante, laissant un trou | **Ne pas** mettre `break-inside: avoid` sur `.doc-scene` — une scène a le droit de traverser un pli |
| Une fiche d'entité coupée en deux | `break-inside: avoid` sur `.doc-entry` — elles sont courtes, elles tiennent |
| Un chapitre qui commence en milieu de page | `.doc-break` (`break-before: page`) sur chaque ouverture |

## Les mentions

Une mention `@[Nom](ref)` s'imprime avec le nom **actuel** de l'entité, en
petites capitales, sans le `@` — une référence croisée visible vers les annexes
plutôt qu'un pseudo au milieu d'un paragraphe. La table de correspondance est
construite par `buildMentionNames()` à partir des entités que le document a
déjà chargées. Une entité supprimée retombe sur le nom saisi à l'époque, comme
partout ailleurs dans l'application.

## Attendre avant d'imprimer

`waitForPaint()` (`frontend/src/print/blocks.tsx`) attend `document.fonts.ready`
et le chargement de chaque `<img>`, puis une frame, avant d'ouvrir la boîte de
dialogue — avec un plafond de 8 s pour qu'une seule URL cassée ne bloque pas
tout le document. L'ancienne fiche appelait `window.print()` sur un `setTimeout`
de 400 ms, ce qui est un pari.

## Fichiers

```
frontend/src/print/print.css        la maquette
frontend/src/print/blocks.tsx       Section, Entry, Field, Scenes, waitForPaint
frontend/src/print/PrintProse.tsx   prose + mentions résolues
frontend/src/print/types.ts         la charge utile
frontend/src/pages/CampaignPrintPage.tsx
frontend/src/pages/PrintPage.tsx
backend/internal/handlers/campaign_print.go
e2e/tests/print.spec.mjs            complétude, images, pagination
e2e/harness/seedBook.mjs            une campagne assez fournie pour juger la maquette
```

Les données de test maigres flattent une mise en page : les noms longs passent
à la ligne, les portraits manquants laissent des trous, une entité citée dans
trois scènes doit tenir dans les trois. `seedBook.mjs` existe pour ça.
