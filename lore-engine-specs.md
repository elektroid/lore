# Lore Engine — Spécifications Fonctionnelles & Techniques

> Application web d'aide à l'écriture de scénarios de jeux de rôle sur table, assistée par LLM.
> Utilisateur cible : MJ expérimenté, usage solo, campagnes cyberpunk principalement.

---

## Table des matières

1. [Vision & Principes](#1-vision--principes)
2. [Architecture Générale](#2-architecture-générale)
3. [Modèle de Données](#3-modèle-de-données)
4. [MVP — Phase 1](#4-mvp--phase-1)
5. [Phase 2 — Graphe de fiches](#5-phase-2--graphe-de-fiches)
6. [Phase 3 — Features avancées](#6-phase-3--features-avancées)
7. [Spécifications LLM](#7-spécifications-llm)
8. [Stack Technique](#8-stack-technique)
9. [API Backend](#9-api-backend)

---

## 1. Vision & Principes

### Philosophie centrale
Lore Engine est un **outil de co-création**, pas un générateur automatique. Le MJ reste auteur — le LLM est un sparring partner rapide. L'IA complète, enrichit et questionne ; elle ne remplace pas, ne détruit pas, ne réécrit pas sans permission.

### Principes de design UX
- **L'IA ne prend jamais l'initiative seule** : toute action LLM est déclenchée par le MJ (bouton explicite) ou proposée de façon discrète et ignorable.
- **Rien n'est perdu** : versioning par snapshots avant chaque action LLM significative.
- **Le statut pilote le comportement de l'IA** : un élément `Mandatory` est intouchable, un élément `Idée` est une invitation à développer.
- **Le contexte de campagne est toujours présent** : chaque appel LLM reçoit le lore global + le résumé condensé des fiches existantes.

### Principes dramaturgiques (Vonnegut appliqué au JdR)
L'app guide structurellement le MJ vers :
- Chaque PNJ principal a une **motivation propre** qui existe indépendamment des joueurs
- Les factions ont un **agenda qui avance** même si les joueurs n'agissent pas
- Le scénario a au moins **un point de non-retour** identifié
- Il existe **plusieurs résolutions possibles** — pas un chemin unique
- Chaque PJ devrait avoir **une accroche personnelle** dans le scénario

---

## 2. Architecture Générale

### Structure applicative
```
Campagne (conteneur global)
│   ├── Lore global (texte libre partagé entre scénarios)
│   ├── Paramètres : genre, ambiance, config LLM
│   └── Scénarios (1-N)
│       ├── Synopsis (étape 1 obligatoire)
│       └── Fiches (étape 2 : PNJ, Lieu, Scène, Faction)
```

### Workflow utilisateur
```
[Nouvelle Campagne] → [Config : genre, ambiance, LLM]
        ↓
[Nouveau Scénario] → [Écran Synopsis — Mode Foisonnement]
        ↓
[Pousser en fiches] → [Écran Fiches — Liste + Éditeur]
        ↓
[Stress Test dramatique] → [Diagnostic + suggestions]
        ↓
[Export PDF optionnel]
```

---

## 3. Modèle de Données

### SQLite — Schéma

```sql
-- Campagnes
CREATE TABLE campaigns (
    id          TEXT PRIMARY KEY,  -- UUID
    name        TEXT NOT NULL,
    genre       TEXT NOT NULL,     -- "cyberpunk", "fantasy", etc.
    ambiance    TEXT,              -- description libre du ton
    lore        TEXT,              -- markdown, lore global partagé
    llm_config  TEXT,             -- JSON : base_url, api_key, model
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Scénarios
CREATE TABLE scenarios (
    id          TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    status      TEXT DEFAULT 'draft',  -- draft | active | archived
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Synopsis
CREATE TABLE synopses (
    id              TEXT PRIMARY KEY,
    scenario_id     TEXT NOT NULL UNIQUE REFERENCES scenarios(id) ON DELETE CASCADE,
    hook            TEXT,           -- JSON : {content, status}
    npcs            TEXT,           -- JSON array : [{id, name, role, notes, status}]
    steps           TEXT,           -- JSON array : [{id, location, event, outcome, status}]
    resolutions     TEXT,           -- JSON array : [{id, title, description, status}]
    overview_cache  TEXT,           -- texte généré pour le mode Overview
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Snapshots de synopsis (versioning)
CREATE TABLE synopsis_snapshots (
    id          TEXT PRIMARY KEY,
    synopsis_id TEXT NOT NULL REFERENCES synopses(id) ON DELETE CASCADE,
    label       TEXT,               -- description de l'action déclenchante
    data        TEXT NOT NULL,      -- JSON complet du synopsis au moment du snapshot
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
-- Max 20 snapshots par synopsis (géré applicativement)

-- Fiches
CREATE TABLE cards (
    id          TEXT PRIMARY KEY,
    scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,      -- npc | location | scene | faction
    title       TEXT NOT NULL,
    status      TEXT DEFAULT 'draft',  -- draft (💡) | in_progress (✓) | confirmed (🔒)
    content     TEXT,               -- JSON : champs structurés selon le type
    body        TEXT,               -- WYSIWYG HTML : notes libres
    origin      TEXT,               -- "synopsis" | "manual" | "llm"
    synopsis_ref TEXT,              -- ID de l'élément synopsis d'origine (nullable)
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Relations entre fiches (Phase 2)
CREATE TABLE card_relations (
    id          TEXT PRIMARY KEY,
    from_card   TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    to_card     TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
    type        TEXT NOT NULL,      -- voir types de relations
    notes       TEXT,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### Structure JSON des fiches par type

**PNJ (npc)**
```json
{
  "role": "Fixer vétéran",
  "motivation": "Rembourser sa dette envers Arasaka avant qu'ils le retrouvent",
  "secret": "Il travaille en double pour le NCPD",
  "mannerism": "Parle peu, toujours en train de tripoter une pièce de monnaie",
  "appearance": "Homme 50 ans, implants oculaires rouillés, veste en cuir synthétique",
  "voice": "Voix basse, phrases courtes, jamais de promesses",
  "hook": "Lien avec les PJs : seul fixer qui accepte les débutants"
}
```

**Lieu (location)**
```json
{
  "district": "Watson",
  "type": "Bar clandestin",
  "atmosphere": "Néons qui clignotent, odeur de synthé-alcool et de cambouis",
  "details": ["Arrière-salle blindée", "Caméras cachées partout", "Sortie de secours verrouillée"],
  "read_aloud": ""
}
```

**Scène / Beat (scene)**
```json
{
  "type": "confrontation",
  "trigger": "Les PJs arrivent au Maelstrom safehouse",
  "objective": "Récupérer le datachip sans déclencher une fusillade",
  "tension": "Le chef Maelstrom sait que les PJs mentent",
  "outcomes": [
    {"result": "Succès négociation", "consequence": "Accès au chip, dette envers Maelstrom"},
    {"result": "Fusillade", "consequence": "Chip détruit, corpo-sécurité alertée"},
    {"result": "Fuite", "consequence": "Maelstrom lance une chasse"}
  ]
}
```

**Faction / Organisation (faction)**
```json
{
  "type": "Corporation",
  "agenda": "Récupérer le prototype volé avant que la concurrence le clone",
  "resources": "Équipes de sécurité, réseau d'informateurs, argent illimité",
  "clock": {
    "name": "Arasaka retrouve la piste",
    "segments": 6,
    "current": 2,
    "trigger": "Avance d'un segment chaque fois que les PJs laissent une trace"
  },
  "key_npcs": []
}
```

### Types de relations (Phase 2)
| From | To | Types possibles |
|---|---|---|
| PNJ | PNJ | allié · ennemi · famille · rival · manipule · ignore |
| PNJ | Lieu | réside · travaille · contrôle · évite · fréquente |
| PNJ | Faction | membre · dirige · infiltre · combat · ignore |
| Scène | PNJ | présent · déclenché_par · révèle · menace |
| Scène | Lieu | se_déroule_dans |
| Faction | Lieu | contrôle · convoite · évite |

---

## 4. MVP — Phase 1

### Périmètre
- Gestion des Campagnes
- Gestion des Scénarios
- **Écran Synopsis complet** avec LLM
- **Écran Fiches** en mode liste (sans graphe visuel)
- Génération de fiche depuis concept court
- Export PDF basique

### 4.1 Gestion des Campagnes

**User Stories**
- `US-C1` : En tant que MJ, je peux créer une campagne avec un nom, un genre et une description d'ambiance libre.
- `US-C2` : Je peux configurer le LLM de la campagne (base_url, api_key, model_name) — compatible OpenAI API standard.
- `US-C3` : Je peux écrire un lore global en markdown (personnages récurrents, organisations, géographie, règles du monde).
- `US-C4` : Je vois la liste de mes campagnes avec leur nombre de scénarios et la date de dernière modification.
- `US-C5` : Je peux archiver ou supprimer une campagne.

**Config LLM**
```json
{
  "base_url": "https://api.anthropic.com/v1",
  "api_key": "sk-...",
  "model": "claude-opus-4-20250514",
  "max_tokens": 2000
}
```
Exemples préconfigurés : Claude (Anthropic), Mistral (api.mistral.ai), Ollama (localhost:11434).

---

### 4.2 Gestion des Scénarios

**User Stories**
- `US-S1` : Je peux créer un scénario dans une campagne, avec juste un nom.
- `US-S2` : La création d'un scénario ouvre automatiquement l'écran Synopsis.
- `US-S3` : Je vois la liste des scénarios d'une campagne (nom, statut, date de modif).
- `US-S4` : Je peux dupliquer un scénario (utile pour variantes ou one-shots dans un même univers).

---

### 4.3 Écran Synopsis

#### Structure de l'écran

L'écran Synopsis est divisé en deux modes accessibles via un toggle en haut de page.

---

#### Mode Foisonnement (édition)

**Layout** : colonne centrale + panneau latéral droit (snapshots)

**Widget 1 — Hook / Concept**
- Champ texte libre, multilignes
- Statut : 💡 / ✓ / 🔒
- Bouton "Compléter" → le LLM enrichit le hook en 2-3 phrases percutantes, sans le remplacer si statut ✓ ou 🔒
- Placeholder : *"Une idée même vague... ex: 'Les PJs sont engagés pour récupérer un prototype, mais quelqu'un d'autre le veut aussi'"*

**Widget 2 — PNJs principaux**
Liste de cartes, chacune avec :
- Nom (texte)
- Rôle / fonction narrative (texte court)
- Notes libres (texte)
- Statut : 💡 / ✓ / 🔒
- Bouton "Développer" → le LLM complète motivation + secret + manie pour ce PNJ
- Bouton "Pousser en fiche" → crée une fiche PNJ dans l'écran Fiches
- Bouton "+" pour ajouter un PNJ manuellement
- Bouton "Suggérer des PNJs" → le LLM propose 2-3 PNJs manquants cohérents avec le hook et les PNJs existants (statut 💡 par défaut, jamais imposés)

**Widget 3 — Grandes étapes**
Liste ordonnée de beats, chacun avec :
- Lieu (texte court)
- Événement (texte)
- Outcome possible (texte)
- Statut : 💡 / ✓ / 🔒
- Bouton "Développer" → LLM enrichit les détails de cette étape
- Bouton "Pousser en fiche Scène"
- Drag & drop pour réordonner
- Bouton "Suggérer une étape manquante" → LLM identifie un gap dramatique et propose un beat

**Widget 4 — Résolutions**
Liste de 1-4 fins alternatives, chacune avec :
- Titre (ex: "Victoire à la Pyrrhus")
- Description (texte)
- Statut : 💡 / ✓ / 🔒
- Bouton "Développer"
- Bouton "+" pour ajouter manuellement
- Bouton "Suggérer des résolutions" → LLM propose des fins alternatives cohérentes

**Panneau latéral — Snapshots**
- Liste chronologique des snapshots (label + heure)
- Clic sur un snapshot : vue diff (éléments ajoutés en vert, supprimés en rouge)
- Bouton "Restaurer" sur chaque snapshot
- Maximum 20 snapshots, les plus anciens supprimés automatiquement
- Snapshot automatique créé avant chaque action LLM significative

**User Stories — Mode Foisonnement**
- `US-SY1` : Je peux saisir une idée de scénario dans le hook, même très vague.
- `US-SY2` : Je peux cliquer "Compléter" sur n'importe quel widget pour que le LLM l'enrichisse.
- `US-SY3` : Le LLM ne modifie jamais un élément avec statut 🔒.
- `US-SY4` : Le LLM ne remplace pas le contenu existant statut ✓ — il ajoute ou complète.
- `US-SY5` : Un snapshot est créé automatiquement avant chaque action LLM.
- `US-SY6` : Je peux voir le diff entre deux snapshots et restaurer un snapshot précédent.
- `US-SY7` : Je peux changer le statut de chaque élément (💡 / ✓ / 🔒) manuellement.
- `US-SY8` : Je peux réordonner les étapes par drag & drop.
- `US-SY9` : Je peux pousser n'importe quel PNJ ou étape en fiche depuis le synopsis.

---

#### Mode Overview (résumé)

Vue condensée, générée à la demande ou mise à jour automatiquement.

**Structure**
```
[Titre du scénario]
[Hook en 2-3 lignes]

PNJs CLÉS
• Kenji (Fixer) — veut survivre, cache une trahison
• Director Yuki (Antagoniste) — récupérer le prototype coûte que coûte
• ...

GRANDES ÉTAPES
1. [Lieu] — [Événement] → [Outcome possible]
2. ...

RÉSOLUTIONS POSSIBLES
→ [Titre] : [Description courte]
→ ...
```

**User Stories — Mode Overview**
- `US-OV1` : Je peux basculer entre Foisonnement et Overview en un clic.
- `US-OV2` : L'overview est régénéré depuis les données actuelles à chaque basculement.
- `US-OV3` : Je peux exporter l'overview en PDF.

---

### 4.4 Écran Fiches

#### Vue Liste
- Filtres par type (PNJ · Lieu · Scène · Faction) et par statut
- Recherche textuelle sur titre + contenu
- Tri par type, statut, date de création
- Bouton "Nouvelle fiche" avec choix du type
- Chaque ligne : icône type · titre · statut · date modif · bouton "Ouvrir"

#### Éditeur de fiche

**Layout** : panneau gauche (champs structurés) + panneau droit (notes libres WYSIWYG)

**Champs structurés** : selon le type (voir JSON section 3), champs texte + statut individuel par champ (pour que le LLM sache quoi toucher).

**Zone WYSIWYG** (TipTap) : notes libres, descriptions longues, éléments à lire à table. Supporte : gras, italique, titres H2/H3, listes à puces, listes numérotées.

**Barre d'actions LLM** (en bas de la fiche) :
- 🪄 **Compléter la fiche** → remplit les champs vides en cohérence avec le lore
- ⚡ **Ajouter une complication** → suggère un twist ou une tension liée à cet élément
- 🎙️ **Habille ça** → génère une description à lire à table dans le corps WYSIWYG
- 🔗 **Suggérer des connexions** → propose des liens avec d'autres fiches existantes (Phase 2 complète, version simplifiée en liste en Phase 1)

**User Stories — Fiches**
- `US-F1` : Je peux créer une fiche manuellement en choisissant son type.
- `US-F2` : Je peux créer une fiche depuis un concept court (titre + quelques mots) et le LLM la complète.
- `US-F3` : Les fiches poussées depuis le synopsis héritent du statut (💡→draft, ✓→in_progress, 🔒→confirmed).
- `US-F4` : Je peux éditer librement tous les champs d'une fiche.
- `US-F5` : Le LLM complète uniquement les champs vides ou en statut 💡 (pas les champs 🔒).
- `US-F6` : Je peux déclencher "Ajouter une complication" sur n'importe quelle fiche.
- `US-F7` : Je peux déclencher "Habille ça" pour générer une description atmosphérique.
- `US-F8` : Je peux supprimer ou archiver une fiche.

---

### 4.5 Stress Test Dramatique

Accessible depuis le menu du scénario. Analyse à la demande, pas en continu.

**Axes d'analyse**

| Axe | Question posée | Signal d'alerte |
|---|---|---|
| Tension autonome | Les factions ont-elles un agenda qui avance sans les PJs ? | Aucune fiche Faction avec un `clock` défini |
| Accroche personnelle | Chaque PJ a-t-il une raison personnelle d'être impliqué ? | Hook vague, pas d'accroches listées dans le synopsis |
| Point de non-retour | Y a-t-il un moment où la situation bascule irréversiblement ? | Aucune étape marquée comme pivot dans les grandes étapes |
| Diversité des issues | Y a-t-il plusieurs résolutions possibles ? | Moins de 2 résolutions dans le synopsis |
| Redondance des chemins | Peut-on atteindre la résolution de plusieurs façons ? | Une seule scène mène à la résolution |

**Output du Stress Test**
Pas une note abstraite — un rapport avec :
- ✅ Axes validés
- ⚠️ Axes fragiles : description du problème + **question concrète** à se poser
- ❌ Axes manquants : suggestion d'action corrective

Exemple de sortie :
```
⚠️  TENSION AUTONOME — fragile
    La faction Arasaka n'a pas d'horloge définie.
    → Que se passe-t-il si les PJs passent 2 sessions sans agir ?
    → Suggestion : ajouter un clock "Arasaka remonte la piste" (6 segments)

✅  DIVERSITÉ DES ISSUES — 3 résolutions définies

❌  POINT DE NON-RETOUR — manquant
    Aucune étape ne semble irréversible.
    → Quelle action des PJs rend impossible le retour à la situation initiale ?
```

**User Stories — Stress Test**
- `US-ST1` : Je peux lancer le Stress Test depuis n'importe quel scénario ayant un synopsis.
- `US-ST2` : Le résultat est un rapport lisible avec des questions concrètes, pas une note.
- `US-ST3` : Je peux relancer le Stress Test après avoir modifié mon scénario.

---

### 4.6 Export PDF

- Export de l'Overview du synopsis seul
- Export d'une fiche individuelle
- Export du scénario complet (overview + toutes les fiches)
- Format A4, mise en page lisible, pas de mise en page complexe pour le MVP

---

## 5. Phase 2 — Graphe de fiches

### Périmètre
- Vue graphe interactif (React Flow) en écran principal des fiches
- Relations typées entre fiches
- Suggestions de connexions basées sur le graphe existant
- Variantes "Et si...?"

### Vue Graphe
- Nœuds colorés par type (PNJ · Lieu · Scène · Faction)
- Arêtes étiquetées avec le type de relation
- Clic sur un nœud : ouvre la fiche en panneau latéral
- Double-clic sur une arête : édite la relation
- Drag pour créer une relation entre deux nœuds
- Filtres : par type de fiche, par faction, par statut
- Mini-map en bas à droite
- Layout automatique (dagre ou force-directed) + réorganisation manuelle

### Suggestions de connexions
Après création ou modification d'une fiche, l'app analyse le graphe existant et propose discrètement (badge sur la fiche) des connexions potentielles : *"Kenji pourrait connaître la faction Maelstrom déjà dans ton graphe — allié ou ennemi ?"*

### Variantes "Et si...?"
Sur n'importe quelle scène ou fiche : bouton "Et si...?" ouvre une modale avec :
- Champ texte : *"Et si les joueurs recrutent Director Yuki ?"*
- Le LLM génère les conséquences en cohérence avec le graphe existant
- Output sauvegardable en note sur la scène

---

## 6. Phase 3 — Features avancées

- **Mode campagne longue** : timeline inter-scénarios, évolution des PNJs récurrents
- **Templates de scénarios** : structures préconfigurées (heist, enquête, escorte, politique...)
- **Descriptions à lire à table** (feature LLM priorité 6) : mode lecture avec police adaptée
- **Tags & recherche avancée** sur l'ensemble de la campagne
- **Import/Export JSON** de campagnes complètes (backup, partage entre MJs)
- **Multi-campagne dashboard** : vue globale de tous les projets actifs

---

## 7. Spécifications LLM

### Principe d'injection de contexte

Chaque appel LLM reçoit un **system prompt** composé dynamiquement :

```
[CONTEXTE CAMPAGNE]
Genre : Cyberpunk
Ambiance : Néo-noir, pluie acide, corporations omnipotentes, espoir rare, technologie omniprésente mais inégale
Lore global : {campaign.lore}

[FICHES EXISTANTES — résumé condensé]
PNJs : {liste condensée : nom + rôle + motivation en 1 ligne}
Lieux : {liste condensée : nom + type + district}
Factions : {liste condensée : nom + agenda}

[RÈGLES DE COMPORTEMENT]
- Tu es un assistant de création de scénarios JdR, pas un auteur autonome.
- Tu complètes, enrichis et suggères. Tu ne remplaces pas ce qui est déjà écrit.
- Les éléments marqués MANDATORY sont intouchables. Ne les modifie pas.
- Les éléments marqués OK peuvent être complétés mais pas réécrits.
- Les éléments marqués IDÉE peuvent être développés librement.
- Reste cohérent avec le lore, le genre et l'ambiance de la campagne.
- Réponds en français.
- Sois concis et actionnable. Pas de remplissage.
```

### Prompts par action

**Compléter le hook**
```
Voici le hook actuel du scénario :
{hook.content}

Enrichis-le en 2-3 phrases percutantes qui introduisent la tension principale et donnent envie de jouer.
Ne réécris pas ce qui est là, complète-le.
Réponds uniquement avec le texte enrichi, sans commentaire.
```

**Suggérer des PNJs**
```
Voici le synopsis actuel :
Hook : {hook}
PNJs existants : {npcs}
Grandes étapes : {steps}

Propose 2-3 PNJs manquants qui rendraient ce scénario plus riche.
Pour chacun, donne : nom · rôle narratif · motivation en une phrase · pourquoi il est intéressant dramatiquement.
Format JSON : [{name, role, notes, rationale}]
```

**Générer une fiche PNJ depuis concept court**
```
Crée une fiche PNJ complète pour : "{concept}"

Retourne un JSON avec ces champs :
- role : rôle narratif dans le scénario
- motivation : ce que ce personnage veut profondément
- secret : ce qu'il cache (au moins une chose)
- mannerism : une manie ou tic distinctif
- appearance : description physique courte
- voice : style de parole, vocabulaire, ton
- hook : son lien potentiel avec les PJs

Reste cohérent avec le lore et l'ambiance de la campagne.
Réponds uniquement en JSON, sans commentaire.
```

**Stress Test dramatique**
```
Analyse ce scénario sur les 5 axes dramatiques suivants :
1. Tension autonome : les factions ont-elles un agenda qui avance sans les PJs ?
2. Accroche personnelle : chaque PJ a-t-il une raison personnelle d'être impliqué ?
3. Point de non-retour : y a-t-il un moment irréversible ?
4. Diversité des issues : y a-t-il plusieurs résolutions possibles ?
5. Redondance des chemins : peut-on atteindre la résolution de plusieurs façons ?

Synopsis :
{synopsis_json}

Fiches existantes :
{cards_summary}

Pour chaque axe, réponds avec : statut (ok/fragile/manquant) · problème identifié (si applicable) · une question concrète à se poser · une suggestion d'action corrective (si applicable).
Format JSON : [{axis, status, problem, question, suggestion}]
```

**Ajouter une complication**
```
Voici la fiche "{card.title}" (type: {card.type}) :
{card_content}

Propose une complication ou un twist dramatique lié à cet élément.
La complication doit :
- Créer de la tension ou de l'ambiguïté
- Être cohérente avec le lore existant
- Laisser plusieurs façons de la résoudre
- Ne pas détruire ce qui est déjà établi

Réponds en 2-3 phrases directement utilisables.
```

**Habille ça (description atmosphérique)**
```
Voici les informations factuelles sur "{card.title}" :
{card_content}

Écris une description à lire à voix haute à la table de jeu.
Style : {campaign.genre}, {campaign.ambiance}
Longueur : 3-5 phrases.
Sollicite les sens : vue, son, odeur.
Termine sur un détail intrigant ou une tension latente.
Réponds uniquement avec le texte à lire, sans commentaire.
```

### Gestion des erreurs LLM
- Timeout : 30 secondes, message d'erreur explicite
- Réponse JSON invalide : retry automatique une fois, puis message d'erreur
- API key invalide : message d'erreur + lien vers les paramètres de la campagne
- Pas de clé configurée : invitation à configurer le LLM dans les paramètres

---

## 8. Stack Technique

### Frontend
- **Framework** : React (Vite)
- **Graphe** : React Flow (Phase 2)
- **Éditeur WYSIWYG** : TipTap
- **Styles** : CSS Modules ou Tailwind
- **State management** : Zustand ou React Query
- **PDF Export** : react-pdf ou appel backend

### Backend
- **Langage** : Go (Golang)
- **Framework HTTP** : Chi ou Gin
- **Base de données** : SQLite via `modernc.org/sqlite` (pur Go, pas de cgo)
- **ORM / Query builder** : sqlc (génération de code typé depuis SQL)
- **UUID** : `github.com/google/uuid`
- **Binaire unique** : le backend sert aussi le frontend buildé en production

### LLM
- **Interface** : OpenAI API standard (compatible Claude, Mistral, Ollama, OpenAI)
- **Appels** : depuis le backend Go (pas depuis le frontend, pour ne pas exposer les clés)
- **Config** : par campagne (base_url + api_key + model)

### Structure du projet
```
lore-engine/
├── backend/
│   ├── cmd/server/main.go
│   ├── internal/
│   │   ├── db/           # sqlc generated + migrations
│   │   ├── handlers/     # HTTP handlers par domaine
│   │   ├── llm/          # client OpenAI-compatible + prompts
│   │   └── models/       # types Go
│   └── go.mod
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── stores/
│   │   └── api/          # client fetch vers le backend
│   └── package.json
└── README.md
```

---

## 9. API Backend

### Campagnes
```
GET    /api/campaigns              → liste des campagnes
POST   /api/campaigns              → créer une campagne
GET    /api/campaigns/:id          → détail d'une campagne
PUT    /api/campaigns/:id          → modifier une campagne
DELETE /api/campaigns/:id          → supprimer une campagne
```

### Scénarios
```
GET    /api/campaigns/:id/scenarios         → liste des scénarios
POST   /api/campaigns/:id/scenarios         → créer un scénario
GET    /api/scenarios/:id                   → détail d'un scénario
PUT    /api/scenarios/:id                   → modifier un scénario
DELETE /api/scenarios/:id                   → supprimer un scénario
POST   /api/scenarios/:id/duplicate         → dupliquer un scénario
```

### Synopsis
```
GET    /api/scenarios/:id/synopsis              → récupérer le synopsis
PUT    /api/scenarios/:id/synopsis              → sauvegarder le synopsis
GET    /api/scenarios/:id/synopsis/snapshots    → liste des snapshots
POST   /api/scenarios/:id/synopsis/restore/:snapshotId  → restaurer un snapshot

POST   /api/scenarios/:id/synopsis/llm/complete-hook    → compléter le hook
POST   /api/scenarios/:id/synopsis/llm/suggest-npcs     → suggérer des PNJs
POST   /api/scenarios/:id/synopsis/llm/develop-npc      → développer un PNJ
POST   /api/scenarios/:id/synopsis/llm/suggest-step     → suggérer une étape
POST   /api/scenarios/:id/synopsis/llm/suggest-resolutions → suggérer des résolutions
POST   /api/scenarios/:id/synopsis/llm/overview         → générer l'overview
```

### Fiches
```
GET    /api/scenarios/:id/cards             → liste des fiches (filtres: type, status)
POST   /api/scenarios/:id/cards             → créer une fiche
GET    /api/cards/:id                       → détail d'une fiche
PUT    /api/cards/:id                       → modifier une fiche
DELETE /api/cards/:id                       → supprimer une fiche

POST   /api/cards/:id/llm/complete          → compléter la fiche
POST   /api/cards/:id/llm/complicate        → ajouter une complication
POST   /api/cards/:id/llm/dress-up          → description atmosphérique
POST   /api/cards/:id/llm/suggest-connections → suggérer des connexions (Phase 2)
```

### Relations (Phase 2)
```
GET    /api/scenarios/:id/relations         → toutes les relations du scénario
POST   /api/relations                       → créer une relation
PUT    /api/relations/:id                   → modifier une relation
DELETE /api/relations/:id                   → supprimer une relation
```

### Stress Test & Export
```
POST   /api/scenarios/:id/stress-test       → lancer le stress test
GET    /api/scenarios/:id/export/pdf        → export PDF du scénario
GET    /api/cards/:id/export/pdf            → export PDF d'une fiche
```

---

## Annexe — Définition du MVP vs Phases

| Feature | MVP | Phase 2 | Phase 3 |
|---|---|---|---|
| Gestion Campagnes | ✅ | | |
| Config LLM par campagne | ✅ | | |
| Lore global | ✅ | | |
| Synopsis — Mode Foisonnement | ✅ | | |
| Synopsis — Mode Overview | ✅ | | |
| Snapshots / versioning | ✅ | | |
| Statuts 💡/✓/🔒 | ✅ | | |
| Fiches en liste | ✅ | | |
| Génération fiche depuis concept | ✅ | | |
| Compléter / Compliquer / Habiller | ✅ | | |
| Stress Test dramatique | ✅ | | |
| Export PDF basique | ✅ | | |
| Graphe interactif React Flow | | ✅ | |
| Relations typées entre fiches | | ✅ | |
| Suggestions de connexions | | ✅ | |
| Variantes "Et si...?" | | ✅ | |
| Timeline inter-scénarios | | | ✅ |
| Templates de scénarios | | | ✅ |
| Import/Export JSON campagne | | | ✅ |
| Multi-campagne dashboard | | | ✅ |
