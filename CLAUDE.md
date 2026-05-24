# Lore — development rules

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
