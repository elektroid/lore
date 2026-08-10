# Joueur — everything for one evening, nothing that belongs to the author

> **A player should never need to understand the author's tools to get to the
> table.**

A player's account exists to answer three questions: which campaigns can I
open, which character am I playing, and where's tonight's table. Everything
else — the story, the cast, the scene graph — belongs to the author and stays
out of the player's way; see [docs/users-authors.md](users-authors.md) and
[docs/runs.md](runs.md) for why that line is drawn deliberately, and where.

---

## 1. Concepts

### Access is not a seat

Two separate facts govern what a player can reach, and neither implies the
other (`docs/runs.md` §2):

| Fact | Table | Granted by |
|---|---|---|
| **May I open this campaign at all?** | `campaign_members` | the author, via **Accès** |
| **Am I actually playing in a group?** | `run_players` | the author, via **Groupes** |

A player can have access and no seat yet ("Accès accordé, en attente d'un
groupe" — `CampaignsPage.tsx`), or, in principle, be removed from a run while
keeping access to browse the campaign. The two are checked independently
everywhere a player is seated.

### Characters belong to the player, not the run

A character (`/characters` — "Mes personnages") is created and owned by the
player, tied to a game system, and reusable across every run that plays that
system. Picking a character for a specific run (`CharacterPanel` in
`RunPlayerPage.tsx`) links an existing character to that seat; it does not
create a new one. A player only sees characters eligible for a run's game.

`player_characters` already carries a `sheet` column — a flat, opaque
`{fieldKey: value}` JSON blob resolved live against the character's game's
`sheet_template` (stats, skills, formulas — `frontend/src/types/sheetTemplate.ts`
defines the shape). Nothing in the frontend fills it in yet: see §4.

### The run is the player's home screen

`/runs/:runId` (`RunPlayerPage.tsx`) is the one page built for a player: which
character they're playing, the session list with a one-click link to the
current table, and a private notes field. There is no player-facing view of
the synopsis, the entity list, or any other author-only surface — a seated
player who navigates there simply has no route to reach it.

### The table doesn't require the account at all

Once a session has a share link, `/table/:token` and `/table/:token/player`
work identically whether opened from a logged-in player's own device or
pasted into a group chat for a guest with no account (`docs/play-table.md`
§1). The account layer and the table layer are independent on purpose: the
account is what lets a player manage characters and notes across sessions;
the token is what lets *anyone in the room* roll dice and see the screen for
one evening.

---

## 2. Workflow, start to finish

1. **Register** an account (`/register`) — role `player` by default.
2. **Wait for access.** The author adds the player to a campaign by searching
   the account's name or email (§1 above); there is no self-service join.
3. **Create a character**, from the home page, for the game system the
   campaign uses — before or after being seated, either order works.
4. **Get seated.** The author assigns the player into a run and, usually,
   pairs them with a character. The run now appears under "Tables" on the
   player's home page.
5. **Between sessions**, open the run (`/runs/:runId`): confirm or change the
   character, see the session list, write private notes — theories, things to
   remember, in-character journaling. Autosaves ~800 ms after typing stops.
6. **On the night**, follow the table link from the run page (or one shared
   in chat): claim a seat by picking a name from the group's roster or typing
   one, roll dice, watch whatever the GM projects — an image, a title card, a
   live-drawn map.
7. **After the session**, come back to the run page; the notes are still
   there, private, next session's context ready.

---

## 3. User stories

### Getting to the table

- As a player, once I'm added to a campaign, it shows up on my home page even
  before I've been put in a group — so I know access is coming, not stuck.
- As a player, I pick my character from the ones I already own for that game
  system, without re-entering anything.
- As a player who missed the session where the roster was built, I still show
  up in the seat picker on table night — the party is the group's, not one
  evening's.
- As a remote player, the same link works on my laptop three time zones away
  as it would on a phone at the physical table.
- As a player, I open the table link once at the start of the evening and
  never need to touch my account again until it's over.

### At the table

- As a player, I roll `2d6+3` from my phone and everyone watching the shared
  screen sees the result land at the same moment I do.
- As a player, I label a roll ("Perception") so the feed reads as something
  that happened, not a bare number.
- As a player joining late, I see the image already on screen and the rolls
  that already happened, instead of walking in blind.

### Keeping track

- As a player, I jot a note mid-session on my phone — a name, a lie an NPC
  told me — and it's still there, private, when I open the run a week later.
- As a player in several campaigns, each run keeps its own notes; nothing
  bleeds from one group's story into another's.

### Explicitly out of scope

Inherited from [docs/play-table.md](play-table.md) §2, still true from the
player's side:

- A chat or text channel inside the app — the group already has voice, or is
  in the room.
- Self-service joining a campaign by code or invite link.
- Shared or GM-visible player notes — they are private by construction, and
  there is no way to make them anything else.

---

## 4. Known gaps

- **No notification when seated or when a session is scheduled.** A player
  finds out by opening the app; nothing pushes to them.
- **The character sheet has a backend and no editor.** `player_characters.sheet`
  and `sheet_templates` (admin-managed, per game, `pc`/`npc`-scoped fields
  including formulas and skill lists) are fully modeled in the schema and API
  (`/api/sheet-templates`), but no page — not character creation, not the run
  page, not the admin game editor — renders or writes a single field of it
  yet. Today "which character" is still just a name and a game-system link.
  This is the single largest gap between what the data model supports and
  what a player can actually do.
- **Seats at the table are unauthenticated.** Anyone with the link can claim
  any name in the roster, including another player's — acceptable at a table
  of friends, not a model to extend past that (`docs/play-table.md` §6).
- **No way for a player to see who else is in their group** outside what the
  seat picker's name list implies.
