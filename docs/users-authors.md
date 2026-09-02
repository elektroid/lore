# Auteur — write a campaign once, run it for years

> **The app manages the campaign so the author can spend their time on the
> story, not on keeping the story straight.**

The author owns a campaign end to end: the cast, the places, the scenes, and
every group that ever plays it. Consistency (a location's district doesn't
change name between scene 3 and scene 30, an NPC's motivation isn't
reinvented) and speed (a full scenario draft in minutes, not an evening) are
the two things the app trades on. See
[docs/scenario-factory.md](scenario-factory.md) for the fullest expression of
that trade: *"the LLM is a co-writer, the GM stays the author."*

---

## 1. Concepts

### Auteur vs. Meneur — two tabs, two capabilities

A campaign owner sees two mode tabs at the top of every campaign page:

| Tab | Route | Capability |
|---|---|---|
| **Auteur** | `/campaigns/:id` | write the material: entities, scenarios, scenes, access |
| **Meneur** | `/campaigns/:id/runs` | run it live: groups, sessions, the play console |

Both belong to the owner. The split exists because a third party can be
granted only the second one — see §4.

### Campaign, scenario, synopsis, scene

A **campaign** holds everything: entities, scenarios, access, groups. A
**scenario** is one story inside it (a campaign usually has several — "the
main plot," "a one-shot side arc"). A scenario's **synopsis** is its scene
graph, edited on `/scenarios/:id/synopsis` — see
[docs/play-improv.md](play-improv.md) for how a scene's state and coherency
are computed during play.

### Four entity types, one pattern

NPCs, Locations, Factions, Artefacts. All four live on
`/campaigns/:id/entities` and follow the shared list-item pattern documented
in `CLAUDE.md` — a clickable name, an avatar or initials, at most two lines of
metadata, edit via a modal once the entity has enough going on (images, LLM
actions) to need one.

### Three ways the LLM helps, not one

| Mechanism | Grain | Where |
|---|---|---|
| **Développer** | one field on one entity or scene | `LLMSuggestionReview` — accept/reject per field |
| **Fabrique** | a whole scenario draft (cast + beat sheet) from a paragraph | [docs/scenario-factory.md](scenario-factory.md) |
| **Brainstorm** | open-ended chat, scoped to a scenario, multiple threads | `BrainstormDrawer.tsx`, off the synopsis editor |

All three are grounded the same way: matched entries from the campaign's game
system, indexed by the administrator (see
[docs/users-admin.md](users-admin.md) §2) and pulled in as facts to stay
consistent with, never text to copy verbatim.

All three also share one dependency the author does not control: the LLM
endpoint is instance-wide configuration (`docs/authorization.md` §2). If the
administrator hasn't configured one, every LLM button on every campaign is
simply unavailable — this is deliberate, not a bug to route around per
campaign.

---

## 2. Workflow, start to finish

1. **Pick a game system.** A campaign needs a `game_id`; the catalog of
   systems is managed by the administrator, not the author (§2 of
   [users-admin.md](users-admin.md)) — the author picks one, doesn't create it.
2. **Create the campaign** — name, description, genre, game.
3. **Populate the cast**, by hand on `/campaigns/:id/entities` or in bulk
   through the **Fabrique**: type a brief, get a pitch, a cast and a beat
   sheet back, edit, then commit.
4. **Build the synopsis** — the scene graph, on
   `/scenarios/:id/synopsis`. Names typed into scene prose become navigable
   mentions automatically once the entity exists.
5. **Brainstorm** anything that isn't ready to become a scene yet, in a
   scenario-scoped chat thread that persists across sessions or general discussion to go back and forth.
6. **Grant access** — `Accès`, on the Auteur tab: search the instance's users
   by name or email and add them to `campaign_members`. This is authorization
   only; it does not seat anyone at a table yet (see
   [docs/runs.md](runs.md) §2, "two player lists, two questions").
7. **Create a run** ("Groupe") per group that will play the campaign, and seat
   players into it (`run_players`) — each seat pairs an account already
   granted access with the character they'll play.
8. **Run a session**, from the Meneur console: pick the scenario, pick the
   session, project images/text/whiteboard to the table, roll dice in the
   open or in secret, tick scenes off as played. See
   [docs/play-table.md](play-table.md).
9. **Export or print** a scenario (`Export JSON`, `/scenarios/:id/print`) —
   for backup, sharing outside the app, or a physical copy at the table.
10. **Archive** a campaign once it's done (`/campaigns/archives`) without
    deleting it — its runs and history stay intact.

---

## 3. User stories

### Writing

- As an author, I write a location once and every scene that references it
  stays in sync — editing the description doesn't require hunting down every
  scene that mentions it.
- As an author, I type a one-paragraph brief and get a full scenario draft —
  cast, locations, a beat sheet that already knows who's in which scene — that
  I can prune before anything touches my campaign.
- As an author, I re-roll one beat I don't like without losing the seven
  others the draft got right.
- As an author, when the factory proposes an NPC I already have, it reuses the
  existing one instead of cloning a duplicate with the same name.
- As an author, I brainstorm an idea that isn't ready to be a scene, in a
  thread I can come back to next week.
- As an author running a licensed game system, my brief and my scenes are
  automatically checked against the indexed sourcebook, so a district or a
  faction name I use matches canon without me having to look it up.

### Running

- As an author, I decide who may open my campaign, one account at a time, and
  can revoke it just as easily.
- As an author with several groups playing the same campaign at different
  paces, each group's progress is tracked separately and none of them can see
  the others' history.
- As an author, I hand a trusted player the ability to run a session for the
  group — without handing them the ability to rewrite my scenario.
- As an author, I can tell at a glance which scenes a given group has already
  played, from the synopsis editor's read-only run lens.

### Explicitly out of scope

- Co-authoring the same campaign with edit rights shared between two accounts
  — a campaign has exactly one owner (§4).
- A campaign-level choice of LLM provider or model — one instance-wide
  configuration serves every campaign (`docs/authorization.md` §2).
- Version history / undo across the whole campaign — a factory draft is the
  one place a big change can be thrown away for free (`docs/scenario-factory.md`).

---

## 4. The delegated Meneur — read, but never write

`AccessSection`'s comment in `CampaignDetailPage.tsx` states the rule plainly:
*"a delegated account (`access === 'member'`) can run this campaign's tables
but never write to the campaign itself."* A member added via **Accès** never
sees the Auteur tab's write controls — no editing entities, no editing the
synopsis, no Fabrique, no Brainstorm — but they can browse everything an
author writes, read-only, before deciding to run a session:

- The campaign overview (`/campaigns/:id`) — pitch, genre, and the scenario
  list (no drag-reorder, no "Nouveau scénario"/"Fabrique", but Accès and
  Export JSON stay visible).
- Entities (`/campaigns/:id/entities`) — NPCs, artefacts, locations, factions,
  opened in the same editor modals an author uses, with every write control
  (edit fields, image upload, LLM actions, delete) hidden.
- A scenario's synopsis (`/scenarios/:id/synopsis`) — scenes, hooks, attached
  NPCs/factions, same treatment.

Landing on the Meneur dashboard's "Mener une table" list sends a delegated
member to the read-only overview first, not straight into the run console —
browse the story, then hit **Mener** when ready. An owner using the same
dashboard still jumps straight to `/campaigns/:id/runs`, since they already
know the material.

Scenario Factory (`/campaigns/:id/factory`) stays fully hidden — it's a
mid-draft generation workbench, not finished story, and "read-only" doesn't
map cleanly onto it.

This is the app's answer to "my co-GM runs half the sessions but I'm the one
who writes the campaign, and they need to actually know the story before they
run it" — one role, granted per account, with a hard line where writing
begins but no line at all on reading.

---

## 5. Known gaps

- **No invite-by-link or by-email.** Granting access means picking an
  existing account from the full user list (`GET /api/users` — every
  registered user's name and email, an accepted small-group trade-off, see
  `docs/authorization.md` "Known gaps"). A player has to register before an
  author can add them.
- **No campaign-level activity feed.** Nothing surfaces "group X played scene
  Y last Tuesday" outside opening that group's console.
- **No collaborative editing indicator.** Nothing stops (or warns about) two
  browser tabs editing the same synopsis at once.
- **No scenario templates or cross-campaign entity reuse.** Every campaign's
  cast starts from zero, or from what the Fabrique invents — nothing carries
  over from a previous campaign in the same game system beyond what the
  sourcebook index already grounds.
- **NPC stat blocks are modeled, not editable.** `campaign_npcs.sheet` stores
  values against the game's `sheet_template` (`npc`-scoped fields) exactly
  like a player character (see [users-players.md](users-players.md) §4), but
  no NPC editor exposes it — an author cannot give an NPC a stat block through
  the app today, however crunchy the game system.
