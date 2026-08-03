CREATE TABLE IF NOT EXISTS games (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    slug              TEXT NOT NULL UNIQUE,
    genre             TEXT NOT NULL DEFAULT '',
    visual_style      TEXT NOT NULL DEFAULT '',
    mistral_agent_id  TEXT NOT NULL DEFAULT '',
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Sourcebook knowledge extracted for a game system (not a campaign): "select
-- Cyberpunk Red" makes the whole indexed ecosystem available to every
-- campaign that uses it. summary/tags/kind/name/source_* are the portable
-- layer — short paraphrase, no book text — so a row is cheap to search (tag
-- filter beats full-text guessing for "a corpo bar") and safe to ship in a
-- game export (see GameHandler.Export) to a GM running their own instance,
-- without redistributing the copyrighted sourcebook itself. source_title is
-- plain text rather than a foreign key so the table stays self-contained on
-- export/import, independent of whether the recipient has indexed anything.
--
-- excerpt is the exception: a near-verbatim quote kept for prompt grounding.
-- It is deliberately NOT part of the export (see gameLoreEntityExport) —
-- that's what keeps the exported layer copyright-light while still letting
-- local prompts draw on the source book's actual wording.
CREATE TABLE IF NOT EXISTS game_lore_entities (
    id            TEXT PRIMARY KEY,
    game_id       TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL,             -- 'district' | 'location' | 'faction' | 'npc_archetype' | 'item' | ...
    name          TEXT NOT NULL,
    tags          TEXT NOT NULL DEFAULT '',  -- free-form facets, e.g. "corpo bar city-center arasaka"
    summary       TEXT NOT NULL DEFAULT '',  -- short paraphrase, not book text — exported
    excerpt       TEXT NOT NULL DEFAULT '',  -- near-verbatim source quote — local-only, never exported
    source_title  TEXT NOT NULL DEFAULT '',  -- e.g. "Night City 2045"
    source_page   INTEGER NOT NULL DEFAULT 0,-- the PDF's own page index (pdftotext -f/-l), not the printed footer number
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaigns (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    genre       TEXT NOT NULL DEFAULT '',
    game        TEXT NOT NULL DEFAULT '',
    -- No REFERENCES here on purpose. The column is NOT NULL DEFAULT '', and ''
    -- is not a games.id, so a foreign key would reject the perfectly ordinary
    -- "campaign with no game system" — and would also reject its own
    -- ON DELETE SET DEFAULT when a game in use is deleted. Integrity is
    -- enforced in the handler, which can say "jeu introuvable" instead of
    -- surfacing a raw SQLite error. See MigrateAlters for existing databases.
    game_id     TEXT NOT NULL DEFAULT '',
    llm_config  TEXT NOT NULL DEFAULT '{}',
    -- Same reasoning as game_id above, and the same shape the rebuild in
    -- MigrateAlters produces — a fresh database must not end up with
    -- constraints an upgraded one lacks. That divergence is what let the
    -- game_id bug hide on the developer's own long-lived database.
    owner_id    TEXT NOT NULL DEFAULT '',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scenarios (
    id          TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'draft',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS synopses (
    id              TEXT PRIMARY KEY,
    scenario_id     TEXT NOT NULL UNIQUE REFERENCES scenarios(id) ON DELETE CASCADE,
    hook            TEXT NOT NULL DEFAULT '{}',
    npcs            TEXT NOT NULL DEFAULT '[]',
    steps           TEXT NOT NULL DEFAULT '[]',

    overview_cache  TEXT NOT NULL DEFAULT '',
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS synopsis_snapshots (
    id          TEXT PRIMARY KEY,
    synopsis_id TEXT NOT NULL REFERENCES synopses(id) ON DELETE CASCADE,
    label       TEXT NOT NULL DEFAULT '',
    data        TEXT NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);


-- A scenario factory run: the GM's brief plus the whole LLM proposal, held as
-- one JSON document until the GM commits it into real scenes and entities.
-- See docs/scenario-factory.md.
CREATE TABLE IF NOT EXISTS scenario_drafts (
    id          TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    scenario_id TEXT NOT NULL DEFAULT '',
    title       TEXT NOT NULL DEFAULT '',
    brief       TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'draft',
    proposal    TEXT NOT NULL DEFAULT '{}',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaign_npcs (
    id          TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT NOT NULL DEFAULT '',
    role        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    quote       TEXT NOT NULL DEFAULT '',
    motivation  TEXT NOT NULL DEFAULT '',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaign_locations (
    id          TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT NOT NULL DEFAULT '',
    city        TEXT NOT NULL DEFAULT '',
    district    TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    atmosphere  TEXT NOT NULL DEFAULT '',
    images      TEXT NOT NULL DEFAULT '[]',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS npc_location_links (
    id          TEXT PRIMARY KEY,
    npc_id      TEXT NOT NULL REFERENCES campaign_npcs(id) ON DELETE CASCADE,
    location_id TEXT NOT NULL REFERENCES campaign_locations(id) ON DELETE CASCADE,
    nature      TEXT NOT NULL DEFAULT '',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS synopsis_npcs (
    id          TEXT PRIMARY KEY,
    scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    npc_id      TEXT NOT NULL REFERENCES campaign_npcs(id) ON DELETE CASCADE,
    status      TEXT NOT NULL DEFAULT 'draft',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scenario_id, npc_id)
);

CREATE TABLE IF NOT EXISTS synopsis_scenes (
    id          TEXT PRIMARY KEY,
    scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    type        TEXT NOT NULL DEFAULT 'scene',
    status      TEXT NOT NULL DEFAULT 'idea',
    sort_order  INTEGER NOT NULL DEFAULT 0,
    title       TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    outcome     TEXT NOT NULL DEFAULT '',
    location_id    TEXT REFERENCES campaign_locations(id) ON DELETE SET NULL,
    playlist_type  TEXT NOT NULL DEFAULT '',
    playlist_value TEXT NOT NULL DEFAULT '',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS scene_npcs (
    id         TEXT PRIMARY KEY,
    scene_id   TEXT NOT NULL REFERENCES synopsis_scenes(id) ON DELETE CASCADE,
    npc_id     TEXT NOT NULL REFERENCES campaign_npcs(id) ON DELETE CASCADE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scene_id, npc_id)
);

CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS campaign_artefacts (
    id          TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    images      TEXT NOT NULL DEFAULT '[]',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS npc_artefact_links (
    id          TEXT PRIMARY KEY,
    npc_id      TEXT NOT NULL REFERENCES campaign_npcs(id) ON DELETE CASCADE,
    artefact_id TEXT NOT NULL REFERENCES campaign_artefacts(id) ON DELETE CASCADE,
    nature      TEXT NOT NULL DEFAULT '',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(npc_id, artefact_id)
);

CREATE TABLE IF NOT EXISTS scene_artefacts (
    id          TEXT PRIMARY KEY,
    scene_id    TEXT NOT NULL REFERENCES synopsis_scenes(id) ON DELETE CASCADE,
    artefact_id TEXT NOT NULL REFERENCES campaign_artefacts(id) ON DELETE CASCADE,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scene_id, artefact_id)
);

-- A run: one group of players and their playthrough of a campaign. The campaign
-- is written once and meant to be played by more than one group, so everything
-- that belongs to a group — its party, its progress — hangs off here and not
-- off the authored material. See docs/adr/0001-runs-separate-story-from-play.md.
CREATE TABLE IF NOT EXISTS runs (
    id          TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT NOT NULL DEFAULT '',
    notes       TEXT NOT NULL DEFAULT '',
    status      TEXT NOT NULL DEFAULT 'active',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- The party. One row per person playing the campaign with this group, with the
-- character they play. Not per session: who is in the group is a property of
-- the group, and re-declaring it every evening is what session_players did.
CREATE TABLE IF NOT EXISTS run_players (
    id           TEXT PRIMARY KEY,
    run_id       TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    character_id TEXT REFERENCES player_characters(id) ON DELETE SET NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(run_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id                 TEXT PRIMARY KEY,
    scenario_id        TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    -- The group whose evening this was. Nullable only because ALTER TABLE on an
    -- existing database cannot add a NOT NULL reference; every session created
    -- through the API has one. See MigrateAlters.
    run_id             TEXT REFERENCES runs(id) ON DELETE CASCADE,
    name               TEXT NOT NULL DEFAULT '',
    date               TEXT NOT NULL DEFAULT '',
    active_location_id TEXT REFERENCES campaign_locations(id) ON DELETE SET NULL,
    active_scene_id    TEXT REFERENCES synopsis_scenes(id) ON DELETE SET NULL,
    -- Table surface: share token for the projection screen and player seats,
    -- and the single thing currently shown there. See docs/play-table.md.
    table_token        TEXT NOT NULL DEFAULT '',
    projection         TEXT NOT NULL DEFAULT '{}',
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Dice rolls made during a session, by the GM or by a player seat.
CREATE TABLE IF NOT EXISTS session_rolls (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    actor      TEXT NOT NULL DEFAULT '',
    actor_kind TEXT NOT NULL DEFAULT 'player',
    notation   TEXT NOT NULL DEFAULT '',
    label      TEXT NOT NULL DEFAULT '',
    detail     TEXT NOT NULL DEFAULT '',
    total      INTEGER NOT NULL DEFAULT 0,
    secret     INTEGER NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS session_scenes (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    scene_id   TEXT NOT NULL REFERENCES synopsis_scenes(id) ON DELETE CASCADE,
    state      TEXT NOT NULL DEFAULT 'cleared',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id, scene_id)
);

-- Something the players did that the scenario never anticipated. Captured in
-- one keystroke during play, developed by the LLM later, optionally adopted as
-- a real scene. `note` is the GM's own words and is never overwritten.
-- See docs/play-improv.md.
CREATE TABLE IF NOT EXISTS session_beats (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    scenario_id     TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    anchor_scene_id TEXT REFERENCES synopsis_scenes(id) ON DELETE SET NULL,
    note            TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'captured',
    title           TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    outcome         TEXT NOT NULL DEFAULT '',
    notes           TEXT NOT NULL DEFAULT '',
    coherency       TEXT NOT NULL DEFAULT '{}',
    scene_id        TEXT REFERENCES synopsis_scenes(id) ON DELETE SET NULL,
    created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaign_factions (
    id          TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    name        TEXT NOT NULL DEFAULT '',
    type        TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    motivation  TEXT NOT NULL DEFAULT '',
    images      TEXT NOT NULL DEFAULT '[]',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS npc_faction_links (
    id         TEXT PRIMARY KEY,
    npc_id     TEXT NOT NULL REFERENCES campaign_npcs(id) ON DELETE CASCADE,
    faction_id TEXT NOT NULL REFERENCES campaign_factions(id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(npc_id, faction_id)
);

CREATE TABLE IF NOT EXISTS faction_location_links (
    id          TEXT PRIMARY KEY,
    faction_id  TEXT NOT NULL REFERENCES campaign_factions(id) ON DELETE CASCADE,
    location_id TEXT NOT NULL REFERENCES campaign_locations(id) ON DELETE CASCADE,
    nature      TEXT NOT NULL DEFAULT '',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(faction_id, location_id)
);

CREATE TABLE IF NOT EXISTS synopsis_factions (
    id          TEXT PRIMARY KEY,
    scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    faction_id  TEXT NOT NULL REFERENCES campaign_factions(id) ON DELETE CASCADE,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(scenario_id, faction_id)
);

CREATE TABLE IF NOT EXISTS brainstorm_threads (
    id          TEXT PRIMARY KEY,
    scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    name        TEXT NOT NULL DEFAULT 'Nouvelle conversation',
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS brainstorm_messages (
    id         TEXT PRIMARY KEY,
    thread_id  TEXT NOT NULL REFERENCES brainstorm_threads(id) ON DELETE CASCADE,
    role       TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- User management tables

CREATE TABLE IF NOT EXISTS users (
    id           TEXT PRIMARY KEY,
    email        TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name         TEXT NOT NULL,
    role         TEXT NOT NULL CHECK(role IN ('superuser', 'player')),
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Campaign members: tracks which users have access to which campaigns
CREATE TABLE IF NOT EXISTS campaign_members (
    id          TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(campaign_id, user_id)
);

-- Player characters: characters created by users, tied to a game system
CREATE TABLE IF NOT EXISTS player_characters (
    id           TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    game_id      TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    personal_story TEXT NOT NULL DEFAULT '',
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Foreign key indexes

CREATE INDEX IF NOT EXISTS idx_campaigns_game_id    ON campaigns(game_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_owner_id   ON campaigns(owner_id);

CREATE INDEX IF NOT EXISTS idx_scenarios_campaign_id ON scenarios(campaign_id);

-- synopses.scenario_id has UNIQUE — already indexed

CREATE INDEX IF NOT EXISTS idx_synopsis_snapshots_synopsis_id ON synopsis_snapshots(synopsis_id);

-- Safe here, unlike the sessions(table_token) case below: scenario_drafts is a
-- brand-new table, so CREATE TABLE IF NOT EXISTS really did create it (with
-- this column) a few statements earlier, on old and new databases alike.
CREATE INDEX IF NOT EXISTS idx_scenario_drafts_campaign_id ON scenario_drafts(campaign_id);

CREATE INDEX IF NOT EXISTS idx_campaign_npcs_campaign_id       ON campaign_npcs(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_locations_campaign_id  ON campaign_locations(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_artefacts_campaign_id  ON campaign_artefacts(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_factions_campaign_id   ON campaign_factions(campaign_id);

-- npc_location_links has no UNIQUE — both sides need an index
CREATE INDEX IF NOT EXISTS idx_npc_location_links_npc_id      ON npc_location_links(npc_id);
CREATE INDEX IF NOT EXISTS idx_npc_location_links_location_id ON npc_location_links(location_id);

-- synopsis_npcs UNIQUE(scenario_id, npc_id) covers scenario_id; npc_id needs its own
CREATE INDEX IF NOT EXISTS idx_synopsis_npcs_npc_id ON synopsis_npcs(npc_id);

CREATE INDEX IF NOT EXISTS idx_synopsis_scenes_scenario_id ON synopsis_scenes(scenario_id);
CREATE INDEX IF NOT EXISTS idx_synopsis_scenes_location_id ON synopsis_scenes(location_id);

-- scene_npcs UNIQUE(scene_id, npc_id) covers scene_id; npc_id needs its own
CREATE INDEX IF NOT EXISTS idx_scene_npcs_npc_id ON scene_npcs(npc_id);

-- npc_artefact_links UNIQUE(npc_id, artefact_id) covers npc_id; artefact_id needs its own
CREATE INDEX IF NOT EXISTS idx_npc_artefact_links_artefact_id ON npc_artefact_links(artefact_id);

-- scene_artefacts UNIQUE(scene_id, artefact_id) covers scene_id; artefact_id needs its own
CREATE INDEX IF NOT EXISTS idx_scene_artefacts_artefact_id ON scene_artefacts(artefact_id);

CREATE INDEX IF NOT EXISTS idx_runs_campaign_id ON runs(campaign_id);

-- run_players UNIQUE(run_id, user_id) covers run_id; the other two need their own
CREATE INDEX IF NOT EXISTS idx_run_players_user_id      ON run_players(user_id);
CREATE INDEX IF NOT EXISTS idx_run_players_character_id ON run_players(character_id);

CREATE INDEX IF NOT EXISTS idx_sessions_scenario_id        ON sessions(scenario_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active_location_id ON sessions(active_location_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active_scene_id    ON sessions(active_scene_id);

-- session_scenes UNIQUE(session_id, scene_id) covers session_id; scene_id needs its own
CREATE INDEX IF NOT EXISTS idx_session_scenes_scene_id ON session_scenes(scene_id);

CREATE INDEX IF NOT EXISTS idx_session_rolls_session_id ON session_rolls(session_id, created_at);

-- Same safety as scenario_drafts above: session_beats is a brand-new table, so
-- these columns exist by the time the indexes run. The scenario_id index carries
-- the cross-session prep query, which is the one that has to stay trivial.
CREATE INDEX IF NOT EXISTS idx_session_beats_scenario_id ON session_beats(scenario_id, created_at);
CREATE INDEX IF NOT EXISTS idx_session_beats_session_id  ON session_beats(session_id);
CREATE INDEX IF NOT EXISTS idx_session_beats_anchor      ON session_beats(anchor_scene_id);
CREATE INDEX IF NOT EXISTS idx_session_beats_scene_id    ON session_beats(scene_id);

-- NOTE: the indexes on sessions(table_token) and sessions(run_id) live in
-- MigrateAlters, not here. CREATE TABLE IF NOT EXISTS is a no-op on a
-- pre-existing sessions table, so on an older database those columns do not
-- exist yet when this file runs — and an index on a missing column aborts the
-- whole migration.

-- npc_faction_links UNIQUE(npc_id, faction_id) covers npc_id; faction_id needs its own
CREATE INDEX IF NOT EXISTS idx_npc_faction_links_faction_id ON npc_faction_links(faction_id);

-- faction_location_links UNIQUE(faction_id, location_id) covers faction_id; location_id needs its own
CREATE INDEX IF NOT EXISTS idx_faction_location_links_location_id ON faction_location_links(location_id);

-- synopsis_factions UNIQUE(scenario_id, faction_id) covers scenario_id; faction_id needs its own
CREATE INDEX IF NOT EXISTS idx_synopsis_factions_faction_id ON synopsis_factions(faction_id);

CREATE INDEX IF NOT EXISTS idx_brainstorm_threads_scenario_id ON brainstorm_threads(scenario_id);
CREATE INDEX IF NOT EXISTS idx_brainstorm_messages_thread_id  ON brainstorm_messages(thread_id);

-- campaign_members UNIQUE(campaign_id, user_id) covers campaign_id; user_id needs its own
CREATE INDEX IF NOT EXISTS idx_campaign_members_user_id ON campaign_members(user_id);

CREATE INDEX IF NOT EXISTS idx_player_characters_user_id ON player_characters(user_id);
CREATE INDEX IF NOT EXISTS idx_player_characters_game_id ON player_characters(game_id);

CREATE INDEX IF NOT EXISTS idx_game_lore_entities_game_id ON game_lore_entities(game_id, kind);
