# Fabrique de scénario — from a broad idea to a full beat sheet

The GM types a paragraph. The engine hands back a complete scenario draft — a
pitch, a cast (NPCs, locations, factions, artefacts) and a beat sheet where
every scene knows where it happens and who is in it. The GM edits it, throws
away what they don't want, and *then* commits it into the campaign.

This is the one feature where the LLM writes a whole story rather than a field.
Everything below exists to keep that from stepping on the guiding principle:

> **The LLM is a co-writer. The GM stays the author.**

---

## 1. Concepts

### Draft ≠ campaign

A factory run produces a **draft** (`scenario_drafts`), not a scenario. A draft
is a single JSON document living beside the campaign. Nothing in it exists as a
scene, an NPC or a location until the GM presses **Créer le scénario**.

That separation is the whole design. It means the engine can be bold — invent
eight scenes, six NPCs and a betrayal — without polluting a campaign the GM has
been curating for months. A bad roll of the dice costs one click on *Supprimer*.

| | Draft | Campaign |
|---|---|---|
| Lives in | one `scenario_drafts` row (JSON) | `scenarios`, `synopsis_scenes`, `campaign_npcs`, … |
| Written by | the LLM, then the GM | only the commit step |
| Cost of throwing away | delete one row | undo a dozen entities by hand |

### The three stages

```
   brief ──▶ [ outline ] ──▶ draft ──▶ [ expand × N ] ──▶ draft ──▶ [ commit ] ──▶ scenario
             1 LLM call               1 LLM call per beat          0 LLM calls
```

**Outline** is where coherence is won. One call produces the pitch, the whole
cast *and* the beat list together, so the model can plan a story where the
fixer in beat 1 is the corpse in beat 6. Generating those lists separately
gives you six disconnected NPCs and a plot that references none of them.

**Expand** fleshes out one beat at a time — description, outcome, GM notes.
One call per beat rather than one call for all of them, for three reasons:
each response stays well inside the token budget, the UI can show real
progress, and a beat the GM doesn't like can be re-rolled alone.

**Commit** is pure database work. No LLM, no surprises: what the GM read is
exactly what lands.

### `ref` — how the model wires the graph

The model cannot invent UUIDs, so every proposed item carries a short handle it
chooses itself (`n1`, `loc2`, `f1`), and scenes point at those handles:

```json
{
  "npcs":      [{ "ref": "n1", "name": "Vanya Kovár", "role": "fixer" }],
  "locations": [{ "ref": "l1", "name": "Le Kabuki noyé" }],
  "scenes":    [{ "ref": "s1", "title": "Le contrat",
                  "location_ref": "l1", "npc_refs": ["n1"], "is_start": true }]
}
```

Commit resolves each `ref` to a real row id and only then writes the links.
An unknown or excluded `ref` is dropped silently — a dangling handle costs a
missing link, never a failed commit.

### Reuse over duplication

The outline prompt is given the names of the NPCs, locations and factions the
campaign already holds, and is told it may reuse them by exact name. On commit,
any proposed entity whose name matches an existing one (case- and
accent-insensitive, trimmed) **binds to the existing row instead of creating a
second one**.

So running the factory on a live campaign extends it — the recurring fixer
stays one NPC with one set of images — instead of cloning it. The review UI
marks those items *Réutilisé* so the GM can see it happening.

### Include, don't accept

Every item in a draft carries `include` (true by default). The review screen is
a set of toggles and editable fields, not a queue of accept/reject prompts.

This is a deliberate departure from the field-level review used by
*Développer* on an NPC or a scene (`LLMSuggestionReview`). That component
answers "should this suggestion overwrite what I already wrote?" — a question
worth asking field by field, because there is something to lose. In a draft
there is nothing to lose yet: the whole document is a proposal, and the GM's
single act of authorship is the commit. Asking them to accept thirty fields
one at a time would be ceremony, not control.

The field-level component *is* reused for one thing: re-expanding a beat that
already has text, where the old question applies again.

---

## 2. Data model

One new table. Everything else in the feature is existing tables, written to
only at commit time.

```sql
CREATE TABLE IF NOT EXISTS scenario_drafts (
    id          TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    scenario_id TEXT NOT NULL DEFAULT '',    -- set on commit
    title       TEXT NOT NULL DEFAULT '',
    brief       TEXT NOT NULL DEFAULT '',    -- the GM's own words, kept verbatim
    status      TEXT NOT NULL DEFAULT 'draft',  -- draft | committed
    proposal    TEXT NOT NULL DEFAULT '{}',  -- the whole document, see below
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scenario_drafts_campaign_id ON scenario_drafts(campaign_id);
```

`proposal` is one JSON blob rather than five relational tables. A draft is
read and written whole, never queried across, and never joined — the only
questions ever asked of it are "show me this draft" and "delete it". Normalising
it would buy nothing and would spread a throwaway document over five tables
with five cascade rules.

> **Migration note.** New table *and* its index in the same `schema.sql` — safe,
> because `CREATE TABLE IF NOT EXISTS` really does create it before the index
> runs. The trap documented in `CLAUDE.md` (an `ALTER`-added column indexed in
> `schema.sql`) does not apply here: no existing table is touched.

### The proposal document

```jsonc
{
  "title":   "Ce qui tourne finit par revenir",
  "pitch":   "…",                    // becomes the synopsis hook
  "factions":  [{ "ref", "name", "type", "description", "motivation", "include" }],
  "locations": [{ "ref", "name", "city", "district", "description", "atmosphere", "include" }],
  "npcs":      [{ "ref", "name", "role", "description", "quote", "motivation",
                  "faction_ref", "include" }],
  "artefacts": [{ "ref", "name", "description", "include" }],
  "scenes":    [{ "ref", "title", "status", "summary", "description", "outcome", "notes",
                  "location_ref", "npc_refs": [], "artefact_refs": [],
                  "is_start", "is_end", "expanded", "include" }]
}
```

`summary` is the one-liner the outline produces; `description` / `outcome` /
`notes` stay empty until that beat is expanded. `expanded` records that it was,
so the UI can show what is still a stub.

Scene `status` reuses the existing vocabulary — `key_event`, `optional_step`,
`idea` — so a committed beat sheet is indistinguishable from a hand-built one.

---

## 3. Endpoints

| Method | Path | Effect |
|---|---|---|
| `GET` | `/api/campaigns/{id}/scenario-drafts` | list drafts for a campaign |
| `POST` | `/api/campaigns/{id}/scenario-drafts` | **outline** — 1 LLM call, returns a full draft |
| `GET` | `/api/scenario-drafts/{draftId}` | read one |
| `PUT` | `/api/scenario-drafts/{draftId}` | save GM edits (title + whole proposal) |
| `DELETE` | `/api/scenario-drafts/{draftId}` | throw away |
| `POST` | `/api/scenario-drafts/{draftId}/regenerate` | re-run the outline, optional instruction |
| `POST` | `/api/scenario-drafts/{draftId}/scenes/{ref}/expand` | **expand** one beat — 1 LLM call |
| `POST` | `/api/scenario-drafts/{draftId}/commit` | materialise into a real scenario |

Draft routes are guarded by `requireDraftOwner`, which resolves the draft to its
campaign and applies the same ownership rule as everything else.

`expand` returns the three generated fields **without persisting them** when
called with `fields`/`instruction` steering — that is the `LLMSuggestionReview`
contract. Called bare, it writes them into the draft.

---

## 4. Commit

Ordered so that every link target exists before the link is written:

1. `CreateScenario` — also creates the empty synopsis (existing transaction).
2. Synopsis hook ← `pitch`.
3. Factions → `synopsis_factions`.
4. Locations.
5. NPCs → `synopsis_npcs` (status `draft`), and `npc_faction_links` from `faction_ref`.
6. Artefacts.
7. Scenes in list order, with `sort_order`, `status`, `is_start` / `is_end`,
   `location_id` resolved from `location_ref`; then `scene_npcs` and
   `scene_artefacts` from the `_refs` arrays.
8. Draft → `status='committed'`, `scenario_id` set.

Excluded items are skipped, and any link pointing at them is skipped with them.
Only one scene can carry `is_start`; the first one wins and the rest are
cleared, matching what the synopsis editor enforces.

A committed draft is kept, not deleted — it is the record of what the machine
proposed, next to what the campaign became.
