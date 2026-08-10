# Administrateur — the plumbing every campaign runs through

> **Nothing an author or a player does should require touching this role —
> until the shared plumbing needs fixing, and then only this role can.**

The administrator (`role: superuser`) doesn't write campaigns and doesn't play
in them. The job is instance-wide configuration that every campaign depends
on but no single author should control: which game systems exist, what
grounds their LLM prompts, and which endpoint and key every campaign's assist
features actually call. See [docs/authorization.md](authorization.md) §2 —
*"instance-wide configuration is the administrator's."*

---

## 1. Concepts

### One role, promoted, not assigned at registration

Every account registers as `player`. The first administrator comes from
`[bootstrap]` in `lore.toml` (see `CLAUDE.md` "Smoke-testing against a real
server"); every one after that is promoted from `/admin`
(`AdminPage.tsx`) by an existing administrator toggling another user's role.
An administrator cannot demote themselves — the toggle is disabled on your own
row — so an instance can never be left with zero.

### What actually requires the role

| Area | Superuser-only | Open to any logged-in user |
|---|---|---|
| Game systems (`/api/games`) | create, update, delete, import/export, visual style | list, read |
| Sourcebook lore entities | create, edit, delete | search/browse (`/lore`) |
| Sheet templates (`/api/sheet-templates`) | create, edit, delete | read — "needed by any character/NPC editor to render a sheet" (router comment) |
| LLM & image settings | set endpoint, key, model | read *whether* one is configured |
| User roles | promote/demote | — |

The pattern repeats: **writes are gated, reads stay open.** An author needs
to know an LLM is configured (to show or hide an assist button) without
needing the key that would let them repoint it — see `docs/authorization.md`
§2 for exactly what's at stake if that boundary moves: the endpoint and key
that *every* campaign's prompts run through.

### The game catalog is shared, campaigns are not

A **game** (`GamesPage.tsx`) is a system — "Cyberpunk RED," a homebrew setting
— that any number of campaigns attach to via `game_id`. It carries external
material (`external-material/<slug>/`, PDFs and documents an author can read
but not upload) and an indexed set of lore entities (districts, factions,
locations, NPC archetypes, items — see `cmd/index-sourcebook`) that ground
every campaign using that system, the mechanism documented in
[docs/scenario-factory.md](scenario-factory.md) under *"Grounded in the
sourcebook."* One administrator action — indexing a sourcebook — improves
every campaign built on it, present and future.

---

## 2. Workflow

1. **Bootstrap** the first administrator account via `lore.toml`'s
   `[bootstrap]` section on a fresh instance.
2. **Create a game system** an author will pick when starting a campaign —
   name, and optionally a generated visual style.
3. **Load its reference material**: import external documents
   (`external-material/<slug>/`) and index the sourcebook's entities so
   `/lore` and every LLM prompt for campaigns in that system have facts to
   stay consistent with (see `docs/scenario-factory.md`, "Grounded in the
   sourcebook, when there is one").
4. **Configure the LLM provider** once for the whole instance — endpoint, API
   key, list and pick a model — the one piece of configuration every
   campaign's Développer, Fabrique and Brainstorm features run through.
5. **Configure image generation**, if the instance uses it, the same way.
6. **Promote trusted users** to administrator as the instance grows past one
   person maintaining it, from `/admin`.

---

## 3. User stories

- As an administrator, I add a new game system once, and every author who
  picks it can start a campaign against it immediately.
- As an administrator, I index a sourcebook's factions and locations once,
  and every campaign in that system gets LLM suggestions that stay consistent
  with canon, without any author having to paste reference text into a
  prompt.
- As an administrator, I point the instance at a different LLM provider, and
  every campaign's assist features pick it up without any author noticing a
  configuration changed.
- As an administrator, I promote a second trusted person so I'm not the only
  one who can fix the LLM configuration if it breaks while I'm away.
- As an author on an instance with no LLM configured yet, every assist button
  is simply absent rather than erroring — I don't need administrator access
  to find that out.

### Explicitly out of scope

- Per-campaign or per-author override of the LLM provider — deliberately one
  instance-wide setting (`docs/authorization.md` §2).
- Usage metering, cost tracking, or per-user quotas on LLM calls.
- Account suspension short of promoting/demoting the `superuser` role — there
  is no "disabled" account state.

---

## 4. Known gaps

- **`GET /api/users` returns every registered user's name and email to any
  authenticated user**, not just administrators — needed so the campaign
  member picker (`docs/users-authors.md` §2) can search by name, accepted as
  a small-group trade-off (`docs/authorization.md`, "Known gaps").
- **No audit log.** Nothing records who changed the LLM endpoint, deleted a
  lore entity, or promoted another user — a shared instance has to trust
  whoever holds the role.
- **No account deactivation.** Removing someone's access means demoting them
  to `player`, which still leaves a working account, just without instance
  config rights.
- **Rate limiting is a stub** outside dice rolls (`docs/authorization.md`,
  "Known gaps") — fine behind a private deployment, a real gap on anything
  more exposed.
- **No UI to manage sheet templates at all**, on either side of the API. The
  route comment says reading is "needed by any character/NPC editor to render
  a sheet," but no editor exists yet — an administrator who wants a game
  system's stat block today has to write to `/api/sheet-templates` directly.
  See [users-players.md](users-players.md) §4 and
  [users-authors.md](users-authors.md) §5 for the consumer side of the same
  gap.
