# ADR-0001 — A *run* separates the story from the parties that play it

**Status:** accepted
**Date:** 2026-07-28

## Context

A campaign is written once and meant to be played by more than one group. That
was the intent from the start, but nothing in the data model said so, and three
things quietly assumed a single group:

1. **`synopsis_scenes.played`** — a boolean on the *story*. The authoring view
   ticked it, struck the scene through, and `BetweenScenesPanel` used it to
   compute "à venir". A second group opening the same scenario inherited the
   first group's strikethroughs. This is play state stored on authored material.

2. **`session_players`** — the party, re-declared for every session. The people
   at the table are a property of the group, not of one evening; asking the GM
   to re-enroll them each session made the roster a per-session accident and
   left no object to ask "who is playing this campaign?".

3. **`campaign_members`** — the ACL, rendered in the campaign editor under the
   heading **Joueurs**, directly below the scenario list. It answers "who may
   open this campaign", which is an authorization question, but it reads as the
   party for the story being written.

Added to that, `sessions.players` — a free-text JSON array — was a fourth,
vestigial roster that no frontend code still read.

So a "party" had to be reconstructed from three overlapping representations,
none of which was the group, and the one piece of genuine progress tracking
(`session_scenes`) was keyed to a single evening rather than to the group.

## Decision

Introduce a **run**: a group of players and their playthrough of a campaign.
In the French UI it is a **Groupe**.

```
campaign ──┬── scenarios ── synopsis_scenes        ← story, party-agnostic
           └── runs ──┬── run_players               ← the party
                      └── sessions ── session_scenes ← one evening each
```

- `runs` hangs off **campaign**, not scenario: a group plays a campaign, and its
  progress spans every scenario in it.
- `sessions.run_id` is added. A session belongs to exactly one run *and* one
  scenario — the evening, and the story it advanced.
- **The party lives on the run** (`run_players`), not on the session.
- **A run's progress is derived, never stored.** "Has this group played scene
  X?" is a join, not a column:

  ```sql
  SELECT ss.scene_id, ss.state
  FROM session_scenes ss JOIN sessions s ON s.id = ss.session_id
  WHERE s.run_id = ?
  ```

  There is no `run_scenes` table. Adding one would recreate exactly the
  duplication this ADR exists to remove: a scene is played because an evening
  happened in which it was played, and `session_scenes` already records that.

### What the layers now mean

| Question | Answer lives in |
|---|---|
| What is the story? | `campaigns`, `scenarios`, `synopsis_scenes`, entities |
| Who may open the campaign? | `campaign_members` (authorization) |
| Which group is playing, with which characters? | `run_players` |
| What happened on the evening of the 12th? | `sessions`, `session_scenes`, `session_rolls`, `session_beats` |
| How far has this group got? | derived from the run's sessions |

Exactly two player-facing lists remain, and they answer different questions:
`campaign_members` is access, `run_players` is the party. The campaign editor
section is relabelled **Accès** to say so.

### Consequences for the UI

The synopsis is **party-agnostic by default**. There is no played checkbox in
the story view unless a run is selected; picking one overlays that group's
progress as a lens. This is the visible form of the whole decision — writing and
running are the same material seen with and without a party attached.

The play console gains a run selector above the session selector, and its
sessions are filtered to the selected run. Creating a session requires a run.

### Superseded columns and tables

`synopsis_scenes.played`, `sessions.players` and `session_players` are no longer
read or written by any code, and are **dropped**: removed from `schema.sql`, and
removed from existing databases by `dropLegacyPlayData` in `db.go`.

The hazard is real — `schema.sql` is `go:embed`-ed and re-run on every hot
reload against the live database (see `CLAUDE.md`), and `main.go` treats a
`Migrate` error as `log.Fatalf`, so destructive DDL there can take the dev
server down. Three properties contain it:

- **Ordered.** The drop runs after `backfillRuns`, never before.
- **Interlocked.** If any campaign still owes a run, nothing is dropped. The
  backfill reads exactly these columns, so dropping one while a campaign still
  needed it would destroy the data instead of migrating it. This is the case
  that would otherwise be silent and unrecoverable.
- **Best-effort.** Every statement tolerates failure, leaving the column in
  place and unread — the state this ADR started from.

The `session_players` **indexes had to leave `schema.sql` too.** An index over a
dropped table aborts the whole migration, which is the `log.Fatalf` path; this
is the same trap already documented for `sessions(table_token)`.

Dropping also keeps a fresh database and an upgraded one identical, which is the
divergence that let the `campaigns.game_id` bug hide on the developer's own
long-lived database (see `dropCampaignGameFK`). A column present in one and
absent in the other is exactly that shape of bug waiting to happen.

## Migration

`backfillRuns` in `db.go` runs once per campaign, best-effort and non-fatal
(same contract as `dropCampaignGameFK`):

- Skipped entirely for any campaign that already has a run — this is what makes
  it idempotent across the hot-reload loop.
- Creates one run, **"Groupe 1"**, for each campaign that has sessions or played
  scenes.
- Attaches every run-less session of that campaign's scenarios to it.
- Seeds `run_players` from the union of that campaign's `session_players`.
- Seeds progress by writing `session_scenes` rows for scenes with `played = 1`,
  attached to the run's **earliest** session.

A campaign with played scenes but **no sessions at all** gets its run, but its
`played` flags are not carried over. There is no evening to attach them to, and
a flag that no session produced was authoring bookkeeping — precisely the state
this ADR abolishes. Inventing a synthetic session to hold it would put fiction
in the session list forever to preserve a boolean.

## Alternatives considered

**A `run_scenes` progress table.** Rejected: it duplicates `session_scenes`, and
the two would drift the first time a session was deleted.

**Runs on the scenario instead of the campaign.** Rejected: a group plays a
campaign. Scenario-scoped runs would force a re-declaration of the same party
for every scenario, which is the `session_players` mistake one level up.

**Keeping the party on the session, with the run as a label only.** Rejected: it
leaves the roster a per-evening accident and keeps "who is in this group?"
unanswerable without scanning sessions.

**Attendance per session.** A run's party is who plays the campaign; who
actually showed up on a given evening is a different, real fact. Not modelled —
no user has asked for it, and `run_players` is the thing the seat picker and the
LLM context need. It would be an additive change if wanted.
