# Lore — development rules

## Dev servers — already running

**The dev servers are started by hand in a terminal (`make dev`). Assume they are
up. Do not start, restart, or kill them.**

| | Port | Runner | Notes |
|---|---|---|---|
| Backend | `8080` | `air` (from `backend/`) | hot-reloads on every Go change |
| Frontend | `5173` | `vite` | proxies `/api`, `/uploads`, `/external-material` → `:8080` |

The live database is **`backend/lore.db`** — `lore.toml` says `lore.db`, and air
runs from `backend/`. It is in WAL mode, so a plain file copy without the `-wal`
sidecar reads as empty. Never write to it.

### Consequences of the hot reload

`schema.sql` is `go:embed`-ed, so **every rebuild re-runs `Migrate` and
`MigrateAlters` against the live database** — a schema change takes effect the
moment the file is saved, before any deliberate action. Two things follow:

- A migration that can fail on an existing database takes the dev server down
  with it (`main.go` treats a `Migrate` error as `log.Fatalf`). Adding a column
  to an existing table plus an index over it is the classic trap — see
  [docs/play-table.md](docs/play-table.md) § data model.
- After editing `schema.sql` or `db.go`, check the migration actually landed
  rather than assuming.

### Smoke-testing against a real server

Do not reuse the dev instance. Build a throwaway one in the scratchpad: its own
`lore.toml`, its own port (`8097`–`8099`), its own db path, and a `[bootstrap]`
user to log in with. Clean up the process when done.

Two gotchas when scripting it:

- A campaign needs a valid `game_id` — `games` has a foreign key, and creating a
  campaign against an empty database fails on it. Create a game first.
- `POST`/`PUT`/`DELETE` need the `X-CSRF-Token` header matching the `lore_csrf`
  cookie from login (double-submit); read it out of the curl cookie jar.

## Entity list items (frontend)

All entity types (NPCs, Artefacts, Locations, Factions, …) follow a shared list-item pattern. Apply it consistently when adding or modifying entity tabs.

### Clickable name

The entity name is always a `<button>` element, never a `<p>` or `<span>`.

```tsx
<button
  className="text-sm font-medium truncate hover:underline text-left"
  onClick={() => /* open edit */}
>
  {entity.name || <span className="text-muted-foreground italic">(sans nom)</span>}
</button>
```

- `hover:underline` signals interactivity without an icon.
- `text-left` keeps alignment natural inside a flex container.
- The empty-name fallback `(sans nom)` is part of the button — still clickable.

### Modal vs. inline edit

| Entity has a dedicated `*EditorModal` | Edit pattern |
|---------------------------------------|--------------|
| Yes (NPC, Artefact, Location)         | `setEditId(entity.id)` — opens the modal |
| No (Faction)                          | `startEdit(entity)` — expands an inline form in the row |

**Rule:** create a modal when the entity needs image management, has many fields, or has LLM actions. All four current entity types (NPC, Artefact, Location, Faction) use modals.

### Avatar / thumbnail

All entity list items show an `EntityAvatar` (`frontend/src/components/EntityAvatar.tsx`) in the left slot.

- If the entity has at least one image: renders a `h-10 w-10` thumbnail; clicking it opens a **lightbox** (fullscreen overlay), not the editor.
- If the entity has no image: renders an initials avatar — first letter of each space-separated word, max 3, uppercase. Background color is deterministic from the name (hash → 8-color palette). **Non-interactive** — no click handler.
- Initials avatar does not open the editor. Use the name or pencil button for that.

### Metadata below the name

Show at most **two lines** of secondary metadata beneath the name:

- First line: the most identifying secondary field (role, atmosphere, type badge…).
- Second line: a description preview — always `line-clamp-2 text-xs text-muted-foreground`.

Do not show more than two metadata lines in the list view; additional detail belongs in the editor.

## User management

### Email verification

Email verification is **disabled** — no SMTP server is available. The `email_verified` field exists in the schema but is never set to `true`. Do not implement verification flows, send confirmation emails, or gate features on `email_verified`. Email changes take effect immediately without any verification step.

### Action buttons

Each row ends with a `shrink-0` button group:

```
[Pencil h-6 w-6 p-0]  [Trash2 h-6 w-6 p-0 text-muted-foreground hover:text-destructive]
```

The pencil button is redundant with the clickable name but kept for discoverability. Both must trigger the same edit action.

## Agent skills

### Issue tracker

Issues live as local markdown files under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout — one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
