# Groupes — écrire une fois, faire jouer plusieurs tables

A campaign is written once and played by more than one group. This is the
feature that makes that true, and keeps the two apart.

The decision and its alternatives are in
[docs/adr/0001-runs-separate-story-from-play.md](adr/0001-runs-separate-story-from-play.md).
This document is how it works.

---

## 1. The line

> **The story is what you wrote. A run is what happened when someone played it.**

Everything follows from which side of that line a fact sits on. "The Rusted
Chapel has a collapsed roof" is the story. "The Tuesday group burned it down in
January" is a run. The first belongs to every group that ever plays; the second
belongs to one of them and must never leak into the others.

The line used to be crossed in three places, and all three are closed:

| Was | Now |
|---|---|
| `synopsis_scenes.played` — a checkbox on the scene | progress derived from the run's sessions |
| `session_players` — the party, re-declared every evening | `run_players` — the party, once, on the group |
| **Joueurs** in the campaign editor — actually the ACL | relabelled **Accès**; the party is under **Groupes** |

---

## 2. Concepts

### The shape

```
campaign ──┬── scenarios ── synopsis_scenes        the story
           │
           └── runs ──┬── run_players               the party
                      └── sessions ── session_scenes  one evening each
```

A **run** hangs off the campaign, not the scenario: a group plays a *campaign*,
and its progress carries across every scenario in it. A **session** belongs to
one run and one scenario — the evening, and the story it advanced.

### Progress is derived, never stored

There is no progress column and no `run_scenes` table. How far a group has got
is a join:

```sql
SELECT ss.scene_id, ss.state
FROM session_scenes ss JOIN sessions s ON s.id = ss.session_id
WHERE s.run_id = ? AND s.scenario_id = ?
ORDER BY s.date, s.created_at
```

A scene is played because an evening happened in which it was played. Storing
that a second time would be a copy free to drift — most obviously the first time
a session got deleted. Later evenings overwrite earlier ones, so a scene voided
in January and replayed in March reads as played.

### Two player lists, two questions

| List | Question | Where |
|---|---|---|
| `campaign_members` | may this account open the campaign? | campaign page → **Accès** |
| `run_players` | who is at this table, playing whom? | campaign page → **Groupes**, or the console |

Access is a prerequisite for the party, not the same thing: you cannot seat
someone who cannot open the campaign, and the API rejects it. A character can
only be assigned to the player who owns it.

---

## 3. The three surfaces

### The synopsis is party-agnostic

The editor shows the story, and by default shows nothing about who has played
it. A **run lens** in the top bar (`Scénario seul` / `Progression : <groupe>`)
overlays one group's progress on the scene list — a green check for played, a
struck-through title, a slash for voided.

The lens is **read-only**. Progress is produced by playing an evening, so it is
ticked off in the play console; writing it from the editor would mean inventing
a session to attach it to. "À venir" is likewise only shown against a lens —
what is left is a question only a group can be asked.

### The play console is scoped to one group

A group selector sits before the session selector, and everything below it — the
session list, the scene states, the party, the improvised beats, the table
token — belongs to that group. Switching groups switches the evening.

Creating a session requires a group. The API refuses one without (`400`), and a
run id from another campaign is a `404` even for the campaign's own owner: the
scenario route proves the scenario, never the run in the body.

### The table surface reads the group's party

The seat picker on `/table/:token/player` offers the names of the **run's**
party, preferring the character name. It used to read the session roster, which
meant a player who missed the evening the roster was built vanished from the
picker. See [docs/play-table.md](play-table.md).

---

## 4. What the LLM is told

Beat development (`docs/play-improv.md`) judges coherency against **the run's**
progress, not the session's. "Déjà jouée" has to mean *this party has been
there*, whether that was tonight or three evenings ago — scoping it to one
evening would present every earlier scene as unplayed and produce nonsense
verdicts.

An adopted beat lands **unplayed for every group, including the one that
improvised it.** The beat becomes authored material at adoption; progress stays
something a run records by playing it. Ticking it off costs one click in the
console.

---

## 5. Upgrading an existing database

`backfillRuns` runs inside `MigrateAlters`, best-effort and non-fatal — a
backfill that cannot finish leaves the database as it found it and lets the
server start anyway. `schema.sql` is embedded and re-run on every hot reload, so
it is also idempotent by construction: **a campaign that already has a run is
skipped entirely.**

For each campaign that has sessions or played scenes and no run yet:

1. create one run, **"Groupe 1"**;
2. attach every run-less session of that campaign's scenarios;
3. seed `run_players` from the union of that campaign's `session_players`;
4. seed progress by writing `session_scenes` rows for `played = 1` scenes,
   against the run's earliest session.

A campaign with played scenes but **no session at all** gets its run and none of
the flags: there is no evening to attach them to, and a `played` with no session
behind it was authoring bookkeeping — the exact thing being abolished.

### Then the drop

Once nothing is owed, the same migration removes what it just read:
`synopsis_scenes.played`, `sessions.players` and the `session_players` table.
They are gone from `schema.sql` too, so a fresh database and an upgraded one end
up with the same shape — a column present in one and absent in the other is how
the `campaigns.game_id` bug survived unnoticed for so long.

`dropLegacyPlayData` is **interlocked**: if `campaignsAwaitingBackfill` returns
anything but zero, it drops nothing and logs why. The backfill reads exactly
these columns, so a backfill that could not finish must never be followed by the
destruction of its input. The check and the backfill share one SQL fragment
(`backfillPendingFrom`) so they cannot drift apart.

Two things to know if you touch this:

- **Never add an index on a dropped column or table to `schema.sql`.** It aborts
  the whole migration, and `main.go` turns that into `log.Fatalf`. The
  `session_players` indexes had to be removed along with the table, for the same
  reason `sessions(table_token)` lives in `MigrateAlters`.
- `hasLegacyPlayData` gates the whole path, so once the drop has run neither the
  backfill nor the drop executes another statement. Detecting "already done" by
  swallowing a *no such column* error on every boot would make a real failure
  indistinguishable from the normal case.
