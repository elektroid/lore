package db

import (
	"database/sql"
	_ "embed"
	"log"
	"strings"

	"github.com/google/uuid"
	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schema string

func Open(path string) (*sql.DB, error) {
	database, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	database.SetMaxOpenConns(1)

	if _, err := database.Exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;`); err != nil {
		database.Close()
		return nil, err
	}

	return database, nil
}

func Migrate(database *sql.DB) error {
	_, err := database.Exec(schema)
	return err
}

// MigrateAlters adds columns to existing tables that predate the current schema.
// Each ALTER is attempted independently; "duplicate column" errors are ignored.
func MigrateAlters(database *sql.DB) {
	alters := []string{
		`ALTER TABLE campaign_npcs ADD COLUMN motivation TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE campaign_locations ADD COLUMN images TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE campaign_npcs ADD COLUMN images TEXT NOT NULL DEFAULT '[]'`,
		`ALTER TABLE synopsis_scenes ADD COLUMN notes TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE campaign_locations ADD COLUMN city TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE campaign_locations ADD COLUMN district TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE synopsis_scenes ADD COLUMN status TEXT NOT NULL DEFAULT 'idea'`,
		`ALTER TABLE campaigns RENAME COLUMN ambiance TO game`,
		`ALTER TABLE synopsis_scenes ADD COLUMN is_start INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE synopsis_scenes ADD COLUMN is_end INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE campaigns ADD COLUMN game_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE campaigns ADD COLUMN owner_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE games ADD COLUMN visual_style TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE games ADD COLUMN mistral_agent_id TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE synopsis_scenes ADD COLUMN playlist_type TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE synopsis_scenes ADD COLUMN playlist_value TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE games ADD COLUMN genre TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE sessions ADD COLUMN table_token TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE sessions ADD COLUMN projection TEXT NOT NULL DEFAULT '{}'`,
		// Must come after the ALTER above: on an older database the column does
		// not exist when schema.sql runs, and indexing a missing column there
		// would abort the whole migration.
		`CREATE INDEX IF NOT EXISTS idx_sessions_table_token ON sessions(table_token)`,
		// A session belongs to the group whose evening it was. NULL default is
		// not a choice: SQLite only allows ALTER TABLE ADD COLUMN to carry a
		// REFERENCES clause when the default is NULL.
		// See docs/adr/0001-runs-separate-story-from-play.md.
		`ALTER TABLE sessions ADD COLUMN run_id TEXT REFERENCES runs(id) ON DELETE CASCADE`,
		`CREATE INDEX IF NOT EXISTS idx_sessions_run_id ON sessions(run_id)`,
		`ALTER TABLE game_lore_entities ADD COLUMN excerpt TEXT NOT NULL DEFAULT ''`,
		`ALTER TABLE games ADD COLUMN description TEXT NOT NULL DEFAULT ''`,
		// sheet_templates is a brand-new table, created by schema.sql (run
		// just before MigrateAlters) on every database, old and new alike —
		// so by the time this ALTER runs, the table it references already
		// exists. NULL default is mandatory here too: ALTER TABLE ADD COLUMN
		// only allows a REFERENCES clause when the default is NULL.
		`ALTER TABLE games ADD COLUMN sheet_template_id TEXT REFERENCES sheet_templates(id) ON DELETE SET NULL`,
		`CREATE INDEX IF NOT EXISTS idx_games_sheet_template_id ON games(sheet_template_id)`,
		`ALTER TABLE player_characters ADD COLUMN sheet TEXT NOT NULL DEFAULT '{}'`,
		`ALTER TABLE campaign_npcs ADD COLUMN sheet TEXT NOT NULL DEFAULT '{}'`,
		`ALTER TABLE campaigns ADD COLUMN pitch TEXT NOT NULL DEFAULT ''`,
	}
	for _, stmt := range alters {
		database.Exec(stmt) //nolint:errcheck — duplicate column error is expected on re-run
	}

	dropCampaignGameFK(database)
	backfillRuns(database)
	dropLegacyPlayData(database)
	dropCampaignLore(database)
}

// dropCampaignLore removes campaigns.lore. "Le monde en quelques paragraphes"
// described the setting, which belongs to the game system every campaign in it
// shares — not to one campaign, and certainly not to one scenario. Nothing reads
// the column any more, so it goes rather than lingering as a field the UI no
// longer offers and no prompt includes.
//
// Ordered after dropCampaignGameFK on purpose: that rebuild no longer copies
// lore either, so on a database old enough to still carry the games foreign key
// the rebuild is what removes the column and this is a no-op.
func dropCampaignLore(database *sql.DB) {
	if !hasColumn(database, "campaigns", "lore") {
		return
	}
	if _, err := database.Exec(`ALTER TABLE campaigns DROP COLUMN lore`); err != nil {
		log.Printf("campaigns.lore not dropped: %v", err)
	}
}

// hasLegacyPlayData reports whether this database still carries the pre-run
// shape: the `played` flag on scenes, the free-text roster on sessions, or the
// per-session roster table.
//
// Everything below is keyed off this rather than off an error from a query that
// mentions a dropped column. Once the drop has happened, a swallowed "no such
// column" on every single boot is indistinguishable from a real failure.
func hasLegacyPlayData(database *sql.DB) bool {
	return hasColumn(database, "synopsis_scenes", "played") ||
		hasColumn(database, "sessions", "players") ||
		hasTable(database, "session_players")
}

func hasColumn(database *sql.DB, table, column string) bool {
	// table and column are compile-time constants from this file, never input.
	rows, err := database.Query(`SELECT 1 FROM pragma_table_info(?) WHERE name = ?`, table, column)
	if err != nil {
		return false
	}
	defer rows.Close()
	return rows.Next()
}

func hasTable(database *sql.DB, table string) bool {
	var n int
	err := database.QueryRow(
		`SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name=?`, table).Scan(&n)
	return err == nil && n > 0
}

// dropLegacyPlayData removes the columns and table that runs superseded:
// synopsis_scenes.played, sessions.players and the whole session_players table.
//
// This is destructive DDL running on every hot reload against the developer's
// live database, where main.go turns a Migrate error into log.Fatalf. Three
// things make that acceptable:
//
//   - It runs after backfillRuns, never before.
//   - It is interlocked: if any campaign still owes a run, nothing is dropped.
//     The backfill reads exactly these columns, so dropping one while a campaign
//     still needed it would destroy the data instead of migrating it.
//   - Every statement is best-effort. A drop that cannot happen leaves the
//     column in place and unread, which is where this change started.
func dropLegacyPlayData(database *sql.DB) {
	if !hasLegacyPlayData(database) {
		return
	}
	if n := campaignsAwaitingBackfill(database); n > 0 {
		log.Printf("legacy play columns kept: %d campaign(s) still awaiting the run backfill", n)
		return
	}
	for _, stmt := range []string{
		`ALTER TABLE synopsis_scenes DROP COLUMN played`,
		`ALTER TABLE sessions DROP COLUMN players`,
		// Dropped last: it is the one the backfill reads to seed a run's party,
		// and the only one carrying rows rather than a column default.
		`DROP TABLE IF EXISTS session_players`,
	} {
		if _, err := database.Exec(stmt); err != nil {
			// Expected once the statement has already run — the columns are
			// gone from schema.sql, so a fresh database never had them.
			continue
		}
	}
}

// campaignsAwaitingBackfill counts the campaigns backfillRuns would still act
// on. Zero is the precondition for dropping what it reads.
func campaignsAwaitingBackfill(database *sql.DB) int {
	var n int
	if err := database.QueryRow(backfillPendingQuery).Scan(&n); err != nil {
		// The columns are already gone, or the schema predates runs entirely.
		// Either way there is nothing here left to protect.
		return 0
	}
	return n
}

// The campaigns backfillRuns still owes a group: they have play data, and no run
// to own it. Shared with the drop interlock below so the two can never disagree
// about what is outstanding — the drop removes exactly what this query reads.
const backfillPendingFrom = `
	FROM campaigns c
	WHERE NOT EXISTS (SELECT 1 FROM runs r WHERE r.campaign_id = c.id)
	  AND (
	    EXISTS (SELECT 1 FROM sessions s
	            JOIN scenarios sc ON sc.id = s.scenario_id
	            WHERE sc.campaign_id = c.id)
	 OR EXISTS (SELECT 1 FROM synopsis_scenes sn
	            JOIN scenarios sc ON sc.id = sn.scenario_id
	            WHERE sc.campaign_id = c.id AND sn.played = 1)
	  )`

const backfillPendingQuery = `SELECT COUNT(DISTINCT c.id) ` + backfillPendingFrom

// backfillRuns gives every pre-run campaign the group its play data implies.
//
// Before runs existed, a campaign's sessions, its per-session rosters and its
// scene `played` flags all silently belonged to one unnamed group. This creates
// that group and moves them onto it.
//
// Idempotent by construction: a campaign that already has a run is skipped
// entirely. That matters more than usual here — schema.sql is embedded and
// re-run on every hot reload, so this executes on every rebuild.
//
// Best-effort and non-fatal, same contract as dropCampaignGameFK: main.go turns
// a Migrate error into log.Fatalf, so a backfill that cannot complete must leave
// the database as it found it and let the server start regardless.
func backfillRuns(database *sql.DB) {
	if !hasLegacyPlayData(database) {
		return // already migrated and dropped
	}
	rows, err := database.Query(`SELECT DISTINCT c.id ` + backfillPendingFrom)
	if err != nil {
		return // pre-runs schema, or a database mid-upgrade — nothing to do
	}
	var campaignIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return
		}
		campaignIDs = append(campaignIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return
	}

	for _, campaignID := range campaignIDs {
		if err := backfillOneCampaignRun(database, campaignID); err != nil {
			log.Printf("run backfill skipped for campaign %s: %v", campaignID, err)
		}
	}
}

func backfillOneCampaignRun(database *sql.DB, campaignID string) error {
	tx, err := database.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck — no-op once committed

	runID := uuid.New().String()
	if _, err := tx.Exec(
		`INSERT INTO runs(id, campaign_id, name) VALUES(?,?,'Groupe 1')`, runID, campaignID); err != nil {
		return err
	}

	// Every session of this campaign that no group has claimed.
	if _, err := tx.Exec(`
		UPDATE sessions SET run_id = ?
		WHERE run_id IS NULL
		  AND scenario_id IN (SELECT id FROM scenarios WHERE campaign_id = ?)`,
		runID, campaignID); err != nil {
		return err
	}

	// The party, as the union of everyone ever enrolled in one of its evenings.
	// A player who used different characters across sessions keeps the most
	// recent one — MAX over a uuid is arbitrary but stable, and the GM re-picks
	// in one click.
	if _, err := tx.Exec(`
		INSERT INTO run_players(id, run_id, user_id, character_id)
		SELECT lower(hex(randomblob(16))), ?, sp.user_id, MAX(sp.character_id)
		FROM session_players sp
		JOIN sessions s ON s.id = sp.session_id
		WHERE s.run_id = ?
		GROUP BY sp.user_id`, runID, runID); err != nil {
		return err
	}

	// Progress: a scene the story called played becomes a scene this group
	// cleared, recorded against its earliest evening. A campaign with played
	// scenes but no session at all gets nothing here — there is no evening to
	// attach it to, and the flag was authoring bookkeeping. See the ADR.
	var firstSession string
	err = tx.QueryRow(`
		SELECT id FROM sessions WHERE run_id = ?
		ORDER BY date, created_at LIMIT 1`, runID).Scan(&firstSession)
	if err == sql.ErrNoRows {
		return tx.Commit()
	}
	if err != nil {
		return err
	}

	if _, err := tx.Exec(`
		INSERT INTO session_scenes(id, session_id, scene_id, state)
		SELECT lower(hex(randomblob(16))), ?, sn.id, 'cleared'
		FROM synopsis_scenes sn
		JOIN scenarios sc ON sc.id = sn.scenario_id
		WHERE sc.campaign_id = ? AND sn.played = 1
		ON CONFLICT(session_id, scene_id) DO NOTHING`,
		firstSession, campaignID); err != nil {
		return err
	}

	return tx.Commit()
}

// dropCampaignGameFK rebuilds `campaigns` without the foreign key on game_id.
//
// The constraint was unsatisfiable in three ordinary situations: creating a
// campaign with no game, clearing a campaign's game, and deleting a game that
// campaigns still point at — the last one because its own ON DELETE SET DEFAULT
// writes '', which the key then rejects. All three surfaced as a 500 carrying a
// raw SQLite message.
//
// Deliberately best-effort and non-fatal: main.go treats a Migrate error as
// log.Fatalf, so a rebuild that cannot complete must leave the database exactly
// as it found it and let the server start anyway. Callers keep working — the
// handler validates game_id either way.
func dropCampaignGameFK(database *sql.DB) {
	var ddl string
	if err := database.QueryRow(
		`SELECT sql FROM sqlite_master WHERE type='table' AND name='campaigns'`).Scan(&ddl); err != nil {
		return
	}
	if !strings.Contains(ddl, "REFERENCES games") {
		return // already rebuilt, or a fresh database created from the current schema
	}

	// foreign_keys is a no-op inside a transaction, so it is toggled outside —
	// without it, DROP TABLE campaigns would cascade into every scenario.
	if _, err := database.Exec(`PRAGMA foreign_keys=OFF`); err != nil {
		return
	}
	defer database.Exec(`PRAGMA foreign_keys=ON`) //nolint:errcheck

	tx, err := database.Begin()
	if err != nil {
		return
	}
	defer tx.Rollback() //nolint:errcheck — no-op once committed

	for _, stmt := range []string{
		`CREATE TABLE campaigns_rebuilt (
			id          TEXT PRIMARY KEY,
			name        TEXT NOT NULL,
			genre       TEXT NOT NULL DEFAULT '',
			game        TEXT NOT NULL DEFAULT '',
			game_id     TEXT NOT NULL DEFAULT '',
			pitch       TEXT NOT NULL DEFAULT '',
			llm_config  TEXT NOT NULL DEFAULT '{}',
			owner_id    TEXT NOT NULL DEFAULT '',
			created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		// pitch is only ever selected here if the ADD COLUMN in MigrateAlters's
		// `alters` slice already ran — that loop executes before this function is
		// called, so the column exists on every path that reaches this INSERT.
		`INSERT INTO campaigns_rebuilt (id,name,genre,game,game_id,pitch,llm_config,owner_id,created_at,updated_at)
		 SELECT id,name,genre,game,game_id,pitch,llm_config,owner_id,created_at,updated_at FROM campaigns`,
		`DROP TABLE campaigns`,
		`ALTER TABLE campaigns_rebuilt RENAME TO campaigns`,
		`CREATE INDEX IF NOT EXISTS idx_campaigns_game_id  ON campaigns(game_id)`,
		`CREATE INDEX IF NOT EXISTS idx_campaigns_owner_id ON campaigns(owner_id)`,
	} {
		if _, err := tx.Exec(stmt); err != nil {
			log.Printf("campaigns FK rebuild skipped: %v", err)
			return // deferred Rollback puts everything back
		}
	}

	if err := tx.Commit(); err != nil {
		log.Printf("campaigns FK rebuild not committed: %v", err)
	}
}
