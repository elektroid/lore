CREATE TABLE IF NOT EXISTS games (
    id                TEXT PRIMARY KEY,
    name              TEXT NOT NULL,
    slug              TEXT NOT NULL UNIQUE,
    genre             TEXT NOT NULL DEFAULT '',
    visual_style      TEXT NOT NULL DEFAULT '',
    mistral_agent_id  TEXT NOT NULL DEFAULT '',
    created_at        DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS campaigns (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    genre       TEXT NOT NULL DEFAULT '',
    game        TEXT NOT NULL DEFAULT '',
    game_id     TEXT NOT NULL DEFAULT '' REFERENCES games(id) ON DELETE SET DEFAULT,
    lore        TEXT NOT NULL DEFAULT '',
    llm_config  TEXT NOT NULL DEFAULT '{}',
    owner_id    TEXT NOT NULL DEFAULT '' REFERENCES users(id) ON DELETE SET DEFAULT,
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
    played         INTEGER NOT NULL DEFAULT 0,
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

CREATE TABLE IF NOT EXISTS sessions (
    id                 TEXT PRIMARY KEY,
    scenario_id        TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
    name               TEXT NOT NULL DEFAULT '',
    date               TEXT NOT NULL DEFAULT '',
    players            TEXT NOT NULL DEFAULT '[]',
    active_location_id TEXT REFERENCES campaign_locations(id) ON DELETE SET NULL,
    active_scene_id    TEXT REFERENCES synopsis_scenes(id) ON DELETE SET NULL,
    created_at         DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at         DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS session_scenes (
    id         TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    scene_id   TEXT NOT NULL REFERENCES synopsis_scenes(id) ON DELETE CASCADE,
    state      TEXT NOT NULL DEFAULT 'cleared',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id, scene_id)
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

-- Session players: links real user accounts (and optionally their characters) to a session
CREATE TABLE IF NOT EXISTS session_players (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    character_id TEXT REFERENCES player_characters(id) ON DELETE SET NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(session_id, user_id)
);

-- Foreign key indexes

CREATE INDEX IF NOT EXISTS idx_campaigns_game_id    ON campaigns(game_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_owner_id   ON campaigns(owner_id);

CREATE INDEX IF NOT EXISTS idx_scenarios_campaign_id ON scenarios(campaign_id);

-- synopses.scenario_id has UNIQUE — already indexed

CREATE INDEX IF NOT EXISTS idx_synopsis_snapshots_synopsis_id ON synopsis_snapshots(synopsis_id);

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

CREATE INDEX IF NOT EXISTS idx_sessions_scenario_id        ON sessions(scenario_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active_location_id ON sessions(active_location_id);
CREATE INDEX IF NOT EXISTS idx_sessions_active_scene_id    ON sessions(active_scene_id);

-- session_scenes UNIQUE(session_id, scene_id) covers session_id; scene_id needs its own
CREATE INDEX IF NOT EXISTS idx_session_scenes_scene_id ON session_scenes(scene_id);

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

-- session_players UNIQUE(session_id, user_id) covers session_id; user_id and character_id need their own
CREATE INDEX IF NOT EXISTS idx_session_players_user_id      ON session_players(user_id);
CREATE INDEX IF NOT EXISTS idx_session_players_character_id ON session_players(character_id);
