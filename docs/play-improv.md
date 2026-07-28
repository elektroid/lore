# Impros — when the party goes off-book

The players do something valid that the scenario never anticipated. The GM
improvises it, it works, and by next Tuesday nobody remembers exactly what was
said. This is the feature that catches it.

---

## 1. The constraint that decides everything

> **At the table, the GM has one hand and about three seconds.**

Everything else here follows from that. A feature that asks the GM to open a
modal, wait on an LLM, and review four fields *while the players are talking*
will not be used — it will be a nice screenshot in a README. So the work is
split in two, and the split is not negotiable:

| | Capture | Develop |
|---|---|---|
| When | mid-scene, players mid-sentence | between scenes, end of session, next week |
| Cost | one field, one Enter | one button, ~10 s of LLM |
| LLM involved | **never** | yes |
| GM attention | none to spare | actually reading |

**The LLM is never in the capture path.** Not for a title, not for a tidy-up,
not for a spinner. The GM types what happened in their own words and gets back
to the table.

Three verbs, total, for the whole feature:

```
   Noter ──▶ Développer ──▶ Adopter
  (3 sec)     (LLM)       (becomes a scene)
```

Anything that would have been a fourth verb was cut.

---

## 2. Concepts

### The note is sacred

`session_beats.note` is what the GM typed at the table. **The LLM never
overwrites it, and neither does anything else.** Development writes into
separate columns (`title`, `description`, `outcome`, `notes`); the raw note
stays visible next to them forever.

This is the same rule as everywhere else in the app — the LLM is a co-writer,
the GM stays the author — but it bites harder here, because the note is also
the only record of what actually happened at the table. Losing it to a tidier
paraphrase would lose the session.

### The anchor

A beat is captured against the **active scene** of the session, its *anchor*.
That is free — the console already tracks which scene is live — and it buys two
things: the LLM knows where in the story the improvisation happened, and adoption
knows where to insert the new scene.

If no scene is active, the beat is anchored to nothing and simply lands at the
end on adoption. No prompt, no picker.

### Coherency is a report, not a gate

Development returns a verdict alongside the prose:

| Verdict | Means | Colour |
|---|---|---|
| `ok` | fits the scenario as written | green |
| `tension` | pulls against something — a planned scene gets harder, an NPC's motive shifts | amber |
| `conflict` | contradicts something already established or already played | red |

"Already played" means **this group** has been there — coherency is judged
against the run's progress, not one evening's. See [docs/runs.md](runs.md).

Plus a one-line summary and a list of **which existing scenes it affects**, each
with a sentence on how.

The verdict never blocks anything. A `conflict` beat can still be adopted with
one click — sometimes the players *did* burn down the building the third act
needed, and the scenario is what's wrong now, not the players. The report tells
the GM where to look; it does not tell them what to do.

The LLM cannot invent UUIDs, so scenes are numbered in the prompt (`s1`, `s2`, …)
and impacts come back by number, resolved to real scenes on the way out — the
same handle trick the scenario factory uses.

### Life cycle

```
captured ──develop──▶ developed ──adopt──▶ adopted
    └────────────────────drop──────────────▶ dropped
```

- **captured** — raw note, nothing else
- **developed** — the LLM has fleshed it out and checked coherency
- **adopted** — it became a real scene in the scenario; `scene_id` points at it
- **dropped** — the GM discarded it; kept, not deleted, because "we decided not
  to keep that" is itself worth remembering next session

A beat can be adopted straight from `captured` without ever being developed. The
GM's own sentence becomes the scene description. Some improvisations don't need
a co-writer.

### Carrying across sessions

Beats are scoped to the **scenario**, not just the session that produced them.
The play console shows this session's; the synopsis editor shows every beat from
every session that has not been adopted or dropped yet.

That is the "next session" half of the feature, and it needed no extra
machinery — just a query without a `session_id` filter. Prep for session 4 opens
with what the players invented in sessions 1 to 3 and nobody has folded in yet.

---

## 3. Data model

One table. Adoption reuses the existing scene machinery, so nothing else moves.

```sql
CREATE TABLE IF NOT EXISTS session_beats (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    scenario_id     TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    anchor_scene_id TEXT REFERENCES synopsis_scenes(id) ON DELETE SET NULL,
    note            TEXT NOT NULL DEFAULT '',   -- the GM's own words, never overwritten
    status          TEXT NOT NULL DEFAULT 'captured',
    title           TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    outcome         TEXT NOT NULL DEFAULT '',
    notes           TEXT NOT NULL DEFAULT '',
    coherency       TEXT NOT NULL DEFAULT '{}', -- verdict + summary + impacts
    scene_id        TEXT REFERENCES synopsis_scenes(id) ON DELETE SET NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

`scenario_id` is denormalised rather than joined through `sessions`, because the
cross-session prep query is the one that has to be trivial.

`coherency` JSON:

```json
{
  "verdict": "tension",
  "summary": "Le contact du Kabuki est mort trois scènes trop tôt.",
  "impacts": [
    { "scene_id": "…", "title": "Le rendez-vous", "note": "Ne peut plus se tenir en l'état." }
  ]
}
```

> **Migration note.** New table plus its indexes in the same `schema.sql` — safe,
> because `CREATE TABLE IF NOT EXISTS` really does create it before the indexes
> run. The trap in `CLAUDE.md` is about indexing an `ALTER`-added column on a
> pre-existing table; no existing table is touched here.

---

## 4. Endpoints

All scenario-scoped, behind the existing `requireScenarioOwner`.

| Method | Path | Effect |
|---|---|---|
| `GET` | `/api/scenarios/{id}/beats` | every beat; `?session_id=` narrows to one session |
| `POST` | `/api/scenarios/{id}/beats` | **capture** — `{session_id, note}`, no LLM |
| `PUT` | `/api/scenarios/{id}/beats/{beatId}` | GM edits, including `status: "dropped"` |
| `DELETE` | `/api/scenarios/{id}/beats/{beatId}` | really delete |
| `POST` | `/api/scenarios/{id}/beats/{beatId}/develop` | **develop** — 1 LLM call |
| `POST` | `/api/scenarios/{id}/beats/{beatId}/adopt` | **adopt** — becomes a scene |

`develop` takes the same optional steering as every other LLM action in the app
(`fields`, `instruction`, `current`) and, with `review: true`, returns the
suggestion without persisting it — the `LLMSuggestionReview` contract.

---

## 5. Adoption

The new scene is inserted **immediately after its anchor**, so the beat sheet
reads in the order the evening actually went. Scenes after the insertion point
have their `sort_order` shifted by one.

It lands as `key_event`, **not played**, linked to the anchor's location, and
carrying the beat's title/description/outcome/notes (falling back to the raw
note when the beat was never developed).

**Why not mark it played, given it demonstrably happened?** Because at adoption
the beat becomes *authored material*, and authored material has no progress of
its own — progress belongs to the group that played it, and marking a scene
played for everyone is precisely the confusion runs exist to prevent. On top of
that, the same beat may well be adopted as *setup for next time* rather than as
a record of last time. Ticking it off costs one click in the console; the cheap
error is the right default. See
[docs/adr/0001-runs-separate-story-from-play.md](adr/0001-runs-separate-story-from-play.md).

The beat keeps its own record either way: status `adopted`, `scene_id` pointing
at what it became.
