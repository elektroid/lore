package db

import (
	"database/sql"
	_ "embed"
	"log"
	"strings"

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
	}
	for _, stmt := range alters {
		database.Exec(stmt) //nolint:errcheck — duplicate column error is expected on re-run
	}

	dropCampaignGameFK(database)
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
			lore        TEXT NOT NULL DEFAULT '',
			llm_config  TEXT NOT NULL DEFAULT '{}',
			owner_id    TEXT NOT NULL DEFAULT '',
			created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`INSERT INTO campaigns_rebuilt (id,name,genre,game,game_id,lore,llm_config,owner_id,created_at,updated_at)
		 SELECT id,name,genre,game,game_id,lore,llm_config,owner_id,created_at,updated_at FROM campaigns`,
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
