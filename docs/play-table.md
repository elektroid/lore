# Table de jeu — projection & dés

How a session reaches the *players* — the screen in the room, the phone in a
player's hand, the browser tab of someone playing remotely.

Everything here hangs off an existing **session** (`sessions` table). A session
is one play event; the table surface lives and dies with it.

---

## 1. Concepts

### The three surfaces

| Surface | Route | Who | Auth | Can write |
|---|---|---|---|---|
| **Console MJ** | `/scenarios/:id/play` | the GM, alone | logged in, campaign owner | everything |
| **Table** | `/table/:token` | the room — TV, projector, second monitor | share token in URL | nothing (read-only) |
| **Siège joueur** | `/table/:token/player` | one player, one device | same share token | own dice rolls only |

The **Table** surface is the one you open fullscreen on the TV in the room. The
**Siège joueur** is the same link with `/player` — it works identically whether
the player is sitting next to you or two time zones away. That is the whole
online-play story: no separate mode, no lobby. One link, two ways to open it.

### The projection contract

> **Nothing appears on the table screen unless the GM puts it there.**

The table surface has no knowledge of the scenario. It does not fetch scenes,
notes, or the NPC list. It renders exactly one thing — the session's current
*projection* — plus the public dice feed. A player who inspects the network
traffic learns nothing the GM did not deliberately show.

This mirrors the app's guiding principle: the LLM is a co-writer, the GM stays
the author. Here — the campaign holds the material, the GM stays the projectionist.

A projection is one of:

- `image` — an entity image (location, NPC, artefact, faction) with an optional caption
- `text` — a title card: a big line and a small line. For in-fiction messages,
  chapter titles, "Trois semaines plus tard…"
- *(empty)* — the idle card: session name, quiet, nothing spoiled

### Dice: who rolls what, and who sees it

| Roll | Origin | Visible on Table | Visible in player feeds | Visible to GM |
|---|---|---|---|---|
| Player roll | player seat | ✅ | ✅ | ✅ |
| GM public roll | console | ✅ | ✅ | ✅ |
| GM secret roll | console | ❌ | ❌ | ✅ |

Two rules make this worth building rather than using physical dice:

1. **The server rolls.** Notation goes up, a result comes down. A player cannot
   nudge a number, and every participant sees the same value at the same moment —
   which is the only thing that makes remote play feel like a table.
2. **Secret means secret.** A GM secret roll never enters the broadcast at all;
   it is not filtered client-side. The event is never published to the hub.

Rolls are persisted per session, so the log survives a refresh, a browser crash,
or a player joining halfway through.

### Seats

A player opening `/table/:token/player` **claims a seat**: they pick their name
from the session's **group** — the party enrolled once on the run, character
name preferred — or types a free-form display name. The claim is stored in
`localStorage` — reopening the link on the same device restores it.

The party is the group's, not the evening's, so a player who missed the session
the roster happened to be built in is still in the picker. See
[docs/runs.md](runs.md).

No login. A group gets going by passing one URL around. The roster picker exists
so the roll feed says *"Kaelen"* rather than *"Player 3"*, and it degrades to a
text field when the GM has not filled the party.

### Why a token and not accounts

The projection screen is very often a browser on a TV, a Chromecast tab, or a
laptop nobody wants to log in on. Requiring an account there is the difference
between a feature that gets used and one that does not.

The token is 32 random hex characters on the session row. It grants exactly:
read the current projection, read the public roll feed, post a roll. It does not
grant scenario, campaign, or entity access. It can be regenerated from the
console, which instantly kills every previously shared link.

**Trade-off, deliberate:** the token is per-session, not per-campaign or
per-scenario. A regular group re-shares a link at each new session. In exchange,
a link cannot outlive the evening it was made for, and "who still has the old
URL" is never a question.

### Transport

Server-Sent Events (`GET /api/table/{token}/stream`). One-directional
server→client is exactly the shape of the problem: the table only receives,
players write through ordinary `POST`s. No WebSocket upgrade, no new dependency,
survives proxies, and `EventSource` reconnects on its own.

Events on the stream:

| Event | Payload | Sent when |
|---|---|---|
| `state` | full snapshot | on connect |
| `projection` | the new projection | GM projects or clears |
| `roll` | one roll | any non-secret roll |
| `ping` | — | every 20 s, keeps the connection warm |

The backend keeps a `Hub` of subscriber channels keyed by session ID. Publishing
is non-blocking: a stalled TV browser cannot slow down the GM's console.

---

## 2. User stories

### GM, in the room

- As a GM, I open the table link on the room's TV once at the start of the
  evening, and never touch that screen again.
- As a GM, when the party arrives at the Rusted Chapel, I click the location's
  image in my console and it appears on the TV — the players see the place
  before I finish describing it.
- As a GM, I show the face of the NPC they are talking to, and swap it for
  another when the conversation moves on.
- As a GM, I clear the screen with one click when the fiction moves somewhere I
  have no art for — the players should not be staring at a stale image.
- As a GM, I put a text card on screen — "Six mois plus tard" — because a title
  card does a scene transition better than a paragraph of narration.
- As a GM, I roll damage in the open, so the players watch the number land.
- As a GM, I roll a stealth check secretly; the table screen shows nothing and
  the players learn nothing from my face.
- As a GM, I read back the evening's rolls from my console when someone asks
  "wait, what did I get on that?".

### GM, online

- As a GM running online, I paste the table link into the group chat and the
  same screen my players would have looked at in the room appears in theirs.
- As a GM, I regenerate the link when a session is over, so a stale tab in
  someone's browser stops updating.

### Player

- As a player, I open the link, pick my character from the list, and I am in —
  no account, no install.
- As a player, I roll `1d20+5` from my phone and everyone in the room sees the
  result appear on the big screen at the same moment.
- As a player, I roll with a label ("Perception") so the feed reads as events,
  not numbers.
- As a player joining late, I see the current image and the rolls that already
  happened.
- As a player, I see what the GM is showing, on my own device, even when I'm the
  one remote member of an otherwise in-person group.

### Explicitly out of scope (MVP)

- Player-visible character sheets, HP, inventory
- Chat / text channel — the group already has voice or is in the same room
- Fog-of-war maps, tokens, grid, initiative tracker
- Audio (see [deezer-integration.md](deezer-integration.md) — separate track)
- Player-uploaded images

---

## 3. Data model

Three additions, no new concepts:

```sql
-- on sessions
table_token TEXT NOT NULL DEFAULT ''   -- 32 hex chars, '' until first share
projection  TEXT NOT NULL DEFAULT '{}' -- JSON, see below

CREATE TABLE session_rolls (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    actor      TEXT NOT NULL DEFAULT '',  -- display name: character, player, or 'MJ'
    actor_kind TEXT NOT NULL DEFAULT 'player',  -- 'gm' | 'player'
    notation   TEXT NOT NULL DEFAULT '',  -- '2d6+3'
    label      TEXT NOT NULL DEFAULT '',  -- 'Perception'
    detail     TEXT NOT NULL DEFAULT '',  -- '2d6[4, 6] + 3'
    total      INTEGER NOT NULL DEFAULT 0,
    secret     INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

The index on `sessions(table_token)` lives in `MigrateAlters`, **not** in
`schema.sql`. `CREATE TABLE IF NOT EXISTS` is a no-op on a database that already
has a `sessions` table, so the column does not exist yet when `schema.sql` runs
there — and an index over a missing column aborts the whole migration, which
`main.go` treats as fatal. Any future column on an existing table has the same
trap.

`sessions.projection` JSON:

```json
{ "kind": "image", "url": "/uploads/…", "title": "Chapelle rouillée", "subtitle": "Quartier bas" }
{ "kind": "text",  "title": "Six mois plus tard", "subtitle": "" }
{ "kind": "" }
```

The projection stores a **URL, not an entity reference**. Deliberate: the table
surface must never need entity read access, and a projection should not silently
change or vanish because the GM edited a location mid-session.

### Dice notation

`backend/internal/dice` parses and rolls. Grammar:

```
expr  := term (('+' | '-') term)*
term  := dice | integer
dice  := [count] 'd' (sides | '%') [('kh' | 'kl') [keep]]
```

Supported: `1d20`, `2d6+3`, `4d6kh3`, `2d20kl1`, `1d8+1d6+2`, `d%`.
Caps (a public endpoint writes to a single-connection SQLite): 64 chars,
20 terms, 100 dice per term, 1000 sides.

---

## 4. API

### Console (authenticated, campaign owner)

Under `/api/scenarios/{id}/sessions/{sessionId}`:

| Method | Path | Body | Result |
|---|---|---|---|
| `POST` | `/table-token` | — | `{ table_token }` — creates or regenerates |
| `PUT` | `/projection` | `{ kind, url, title, subtitle }` | broadcasts `projection` |
| `DELETE` | `/projection` | — | broadcasts an empty `projection` |
| `GET` | `/rolls` | — | `Roll[]`, newest first, **including secret** |
| `POST` | `/rolls` | `{ notation, label, secret }` | the roll; broadcasts unless `secret` |

### Table & seats (public, token is the credential)

Under `/api/table/{token}`:

| Method | Path | Result |
|---|---|---|
| `GET` | `/` | `{ session_name, scenario_name, campaign_name, projection, rolls, seats }` — never secret rolls |
| `GET` | `/stream` | SSE |
| `POST` | `/rolls` | `{ actor, notation, label }` → the roll; broadcasts |

These routes skip the auth and CSRF middleware — the token in the path *is* the
capability. Player rolls are rate-limited to one per 500 ms per token.

---

## 5. Frontend map

```
pages/TablePage.tsx        /table/:token          projection + feed, fullscreen dark
pages/PlayerSeatPage.tsx   /table/:token/player   seat claim + roller + feed
components/play/
  DiceRoller.tsx           notation input + quick dice, shared by GM and players
  RollFeed.tsx             the roll list, shared by all three surfaces
  ProjectionPanel.tsx      GM: image tray, what's live, clear, text card
  GMDiceTray.tsx           GM: roller + secret toggle + the full log
  TableShareDialog.tsx     GM: the links, copy buttons, regenerate
hooks/useTableStream.ts    EventSource + reconnect, returns the snapshot
lib/dice.ts                notation validation + presets for the UI
```

The console subscribes to the same public stream the table screen uses, so player
rolls land there live. Its roll list still comes from the authenticated endpoint —
that is the only one carrying secret rolls — refreshed off the stream's events.

`TablePage` and `PlayerSeatPage` are **public routes** — outside `ProtectedRoute`,
outside `AppShell`. They render their own chrome: the table is pure black, the
player seat is a phone-first single column.

The GM console keeps its two-column layout and gains a third block below the
scene detail: projection tray on the left, dice on the right.

---

## 6. Known limits after the MVP

- **No QR code.** The share dialog shows the URL and a copy button. A QR would
  be materially better at a physical table; it needs an encoder, and every
  hosted-image QR service is an external dependency the app does not otherwise
  have.
- **Seats are not authenticated.** Anyone with the link can claim any name,
  including another player's. Acceptable at a table of friends; not a model to
  extend to strangers.
- **Rolls are not tied to characters.** `actor` is a display string, not a
  `player_characters` reference. Linking them would let the roller pre-fill a
  character's attributes — the natural next step, and the reason `actor_kind`
  exists.
- **SSE state is per-process.** A multi-instance deployment would need the hub
  behind Redis or similar. Lore runs as a single Go process today.
- **No projection history.** The GM cannot go "back" to the previous image; the
  tray makes re-projecting a click, so this is a convenience gap, not a hole.
