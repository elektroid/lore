# Lore Engine

Outil de co-création de scénarios pour jeux de rôle sur table, assisté par LLM.

Le MJ reste auteur — le LLM est un sparring partner rapide. L'IA complète, enrichit et questionne ; elle ne remplace pas.

---

## Fonctionnalités

- **Gestion de campagnes** — campagnes multi-utilisateurs avec rôles (superutilisateur / joueur)
- **Fiches d'entités** — PNJs, Artefacts, Lieux, Factions avec suggestions LLM et génération d'images
- **Éditeur de synopsis** — scènes par glisser-déposer, versioning par snapshots, diff visuel
- **Brainstorm** — outil LLM libre pour explorer des idées de scénario
- **Recherche globale** — recherche plein-texte sur toutes les entités d'une campagne
- **Export print** — vue imprimable du synopsis
- **API LLM configurable** — toute API compatible OpenAI (Ollama, Anthropic, Mistral, OpenAI…)

## Stack

- **Backend** : Go, [Chi](https://github.com/go-chi/chi), SQLite (`modernc.org/sqlite`), [sqlc](https://sqlc.dev)
- **Frontend** : React + Vite, TypeScript, Tailwind CSS, [shadcn/ui](https://ui.shadcn.com), React Query, Zustand, TipTap, dnd-kit
- **LLM** : client OpenAI-compatible (local ou cloud)

## Prérequis

- Go 1.22+
- Node.js 22+
- [`air`](https://github.com/air-verse/air) pour le hot-reload Go
- [`sqlc`](https://sqlc.dev) pour regénérer les requêtes SQL typées

```bash
make install-tools
```

## Démarrage rapide

```bash
# 1. Copier et adapter la configuration
cp lore.toml.example lore.toml

# 2. Lancer les deux serveurs en dev
make dev-backend   # Terminal 1 — backend Go sur :8080
make dev-frontend  # Terminal 2 — frontend Vite sur :5173
```

Ouvrir [http://localhost:5173](http://localhost:5173).

Au premier lancement, si `bootstrap.user` est configuré dans `lore.toml`, le compte superutilisateur est créé automatiquement.

## Configuration

La configuration est lue depuis `lore.toml` (ignoré par git). Les variables d'environnement ont priorité sur le fichier.

| Clé TOML | Variable d'env | Défaut |
|---|---|---|
| `server.host` | `LORE_HOST` | `localhost` |
| `server.port` | `LORE_PORT` | `8080` |
| `database.path` | `LORE_DB_PATH` | `lore.db` |
| `jwt.secret` | `LORE_JWT_SECRET` | *(dev default — changer en prod)* |
| `jwt.access_expiry` | `LORE_JWT_ACCESS_EXPIRY` | `24h` |
| `jwt.refresh_expiry` | `LORE_JWT_REFRESH_EXPIRY` | `168h` |
| `cors.origins` | `LORE_CORS_ORIGINS` | `http://localhost:5173` |

### LLM

La configuration LLM globale (`[llm]` dans `lore.toml`) sert de base. Chaque campagne peut surcharger le modèle et la clé API via l'interface — la clé n'est jamais exposée au frontend.

Pour utiliser [Ollama](https://ollama.ai) en local :

```toml
[llm]
base_url = "http://localhost:11434/v1"
api_key  = "ollama"
model    = "llama3.2:latest"
```

Pour utiliser OpenAI :

```toml
[llm]
base_url = "https://api.openai.com/v1"
api_key  = "sk-..."
model    = "gpt-4o-mini"
```

### Génération d'images (optionnel)

La génération d'images pour les entités utilise l'API Mistral :

```toml
[mistral]
api_key    = "votre-clé"
image_count = 3
```

## Build production

```bash
make build
```

Produit un binaire `lore-engine` autonome qui sert le frontend buildé. La base de données SQLite est créée à côté du binaire au premier lancement.

## Structure du projet

```
lore/
├── backend/
│   ├── cmd/server/        # point d'entrée
│   └── internal/
│       ├── auth/          # JWT, middleware, RBAC
│       ├── config/        # lecture lore.toml + env vars
│       ├── db/            # schéma SQLite + requêtes typées (sqlc)
│       ├── handlers/      # handlers HTTP Chi par domaine
│       └── llm/           # client OpenAI-compatible + prompts
├── frontend/
│   └── src/
│       ├── api/           # client fetch vers le backend
│       ├── components/    # composants UI (shadcn + métier)
│       ├── pages/         # pages React Router
│       ├── stores/        # état UI global (Zustand)
│       └── types/         # types TypeScript partagés
├── Makefile
└── lore.toml.example
```

## État du développement

Le projet est fonctionnel et utilisable en production (usage personnel / petit groupe). Les fonctionnalités principales sont implémentées :

- [x] Authentification JWT avec refresh tokens
- [x] Gestion des campagnes et des membres
- [x] Fiches entités (PNJs, Artefacts, Lieux, Factions) avec édition LLM
- [x] Génération d'images via Mistral AI
- [x] Éditeur de synopsis avec gestion de scènes et snapshots
- [x] Brainstorm LLM
- [x] Recherche plein-texte
- [x] Export print / PDF

En cours / prévu :

- [ ] Interface joueur (accès campagne en lecture, fiches personnage)
- [ ] Ingestion de PDF (matériel source pour le contexte LLM)
- [ ] Graphe de relations entre entités

## Licence

Ce projet est distribué sous licence [MIT](LICENSE).
